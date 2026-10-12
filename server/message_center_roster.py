#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def write_roster(payload_path, output_path):
    try:
        from openpyxl import Workbook
    except Exception as exc:
        raise RuntimeError("当前 Python 环境缺少 openpyxl，请先安装依赖") from exc

    payload = json.loads(Path(payload_path).read_text("utf-8"))
    rows = payload.get("rows") if isinstance(payload, dict) else []
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "名单"
    sheet.append(["姓名", "手机号码", "邮箱"])
    for row in rows or []:
        sheet.append([
            str(row.get("name") or "").strip(),
            str(row.get("phone") or "").strip(),
            str(row.get("email") or "").strip(),
        ])
    for column in ("A", "B", "C"):
        for cell in sheet[column]:
            cell.number_format = "@"
    workbook.save(output_path)
    return {"ok": True, "path": str(output_path), "count": len(rows or [])}


def main():
    if len(sys.argv) != 3:
        raise RuntimeError("Usage: message_center_roster.py payload.json output.xlsx")
    print(json.dumps(write_roster(sys.argv[1], sys.argv[2]), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise
