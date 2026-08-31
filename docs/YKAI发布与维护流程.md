# YKAI 发布与维护流程

## 固定环境

| 用途 | 地址 | 运行目录 | 规则 |
| --- | --- | --- | --- |
| 同事正式使用 | `http://172.16.13.214:8765/fanwei-test` | `/Users/chen/Library/Application Support/yikao-auto-config-web` | 正式数据、正式账号和定时任务只在这里运行 |
| 本机开发测试 | `http://127.0.0.1:8766/fanwei-test` | `/Users/chen/Library/Application Support/yikao-auto-config-test/YKAI001/app` | 使用独立数据；自动定时任务关闭；允许手动选择测试账号操作 |
| 源码 | 无固定网址 | `/Users/chen/Desktop/ai 易考` | 修改源码不会自动影响 8765 |

当前正式基线为 `YKAI001`。正式第一版完整备份位于：

```text
/Users/chen/Library/Application Support/yikao-auto-config-backups/正式上线第一版备份
```

该备份包含账号、配置和业务数据，只能保存在受控机器上，不能发送给同事。

## 新功能开发

1. 只在源码目录修改代码。
2. 将源码同步到测试服务：

   ```bash
   node scripts/test_service_launchd.mjs sync
   ```

3. 打开 `http://127.0.0.1:8766` 验证页面、接口和目标业务流程。
4. 需要真实创建考试时，手动确认当前选择的是测试账号。
5. 确认 8765 的 PID、运行目录和健康状态没有变化。

## 正式 Bug 处理

1. 记录问题所在项目、页面、操作步骤、时间和报错，不直接修改 8765。
2. 将正式数据库单向刷新到 8766：

   ```bash
   ./scripts/refresh_test_environment.sh --include-uploads
   ```

3. 在 8766 复现问题；不能复现时保留正式现场，不猜测修改。
4. 在源码中修复，再同步到 8766 验证原问题和相关回归场景。
5. 验证通过后生成新的连续版本，例如 `YKAI002`。

## 生成发布包

从已经验证的 8766 应用副本生成发布包，不从脏源码目录直接上线：

```bash
node scripts/production_release.mjs prepare --release YKAI002 --confirm YKAI002
node scripts/production_release.mjs preflight --release YKAI002
```

`preflight` 只读检查发布清单、8765 PID、运行目录、LaunchAgent 和健康接口，不复制文件、不重启服务。

## 正式上线

只有明确批准上线后才执行：

```bash
node scripts/production_release.mjs deploy --release YKAI002 --confirm YKAI002
```

部署会：

1. 校验发布包中的全部文件和 SHA-256 清单。
2. 备份当前正式代码。
3. 使用 SQLite 一致性快照备份两个数据库，并备份正式配置。
4. 短暂停止 8765，替换应用代码，保留正式数据、账号、上传和日志。
5. 启动并检查健康状态和运行目录。
6. 新版本启动失败时自动恢复部署前代码。

上线后必须检查：

```bash
node scripts/production_release.mjs status
curl -fsS http://127.0.0.1:8765/api/health
```

然后验证同事地址能进入登录页、目标页面正常、定时任务仍只由 8765 执行。涉及泛微或运控浏览器操作时，还要单独检查使用者本机的 18765 助手；更新 8765 不会自动更新每台电脑的助手。

## 回滚

部署成功后会返回形如 `before-YKAI002-时间` 的备份编号。需要回滚时使用完全相同的编号确认：

```bash
node scripts/production_release.mjs rollback \
  --backup before-YKAI002-YYYYMMDDTHHMMSS \
  --confirm before-YKAI002-YYYYMMDDTHHMMSS
```

默认回滚只恢复代码，不覆盖上线后新增的业务数据。部署备份中保留数据库和配置快照，但恢复数据库属于可能丢失新数据的独立操作，必须先核对时间范围并单独批准。

## 日常检查

```bash
node scripts/production_release.mjs status
node scripts/test_service_launchd.mjs status
curl -fsS http://127.0.0.1:18765/health
```

同时检查磁盘空间、服务错误日志、定时任务最近执行结果和部署备份可读性。不要将 8766 的定时任务打开，也不要让第二个服务同时承担正式定时任务。
