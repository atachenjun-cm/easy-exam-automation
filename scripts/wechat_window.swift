import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import Vision

func mainWindow() -> (id: Int, pid: pid_t, bounds: CGRect)? {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
  var candidates: [(id: Int, pid: pid_t, bounds: CGRect)] = []
  for window in windows {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let layer = window[kCGWindowLayer as String] as? Int ?? -1
    guard layer == 0, owner.localizedCaseInsensitiveContains("WeChat") || owner.contains("微信") else { continue }
    guard let id = window[kCGWindowNumber as String] as? Int,
          let pid = window[kCGWindowOwnerPID as String] as? pid_t,
          let boundsValue = window[kCGWindowBounds as String],
          let bounds = CGRect(dictionaryRepresentation: boundsValue as! CFDictionary) else { continue }
    guard bounds.width >= 640, bounds.height >= 420 else { continue }
    candidates.append((id, pid, bounds))
  }
  return candidates.max { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }
}

func requireMainWindow() -> (id: Int, pid: pid_t, bounds: CGRect) {
  guard let window = mainWindow() else {
    fputs("微信未登录或主聊天窗口不可见\n", stderr)
    exit(1)
  }
  return window
}

func windowSharingState(_ windowID: Int) -> Int {
  let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  for window in windows where window[kCGWindowNumber as String] as? Int == windowID {
    return window[kCGWindowSharingState as String] as? Int ?? -1
  }
  return -1
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) {
  let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)
  down?.flags = flags
  down?.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
  up?.flags = flags
  up?.post(tap: .cghidEventTap)
  usleep(100_000)
}

func isWeChatApplication(_ app: NSRunningApplication?) -> Bool {
  guard let app else { return false }
  return app.bundleIdentifier == "com.tencent.xinWeChat"
    || app.localizedName?.localizedCaseInsensitiveContains("WeChat") == true
    || app.localizedName?.contains("微信") == true
}

func activateWeChat() {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  process.arguments = ["-a", "WeChat"]
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fputs("无法激活微信：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  if process.terminationStatus != 0 {
    fputs("无法激活微信\n", stderr)
    exit(1)
  }
  let apps = NSWorkspace.shared.runningApplications.filter { app in
    isWeChatApplication(app)
  }
  let deadline = Date().addingTimeInterval(5)
  while Date() < deadline {
    for app in apps {
      app.unhide()
      app.activate(options: [.activateAllWindows])
    }
    if isWeChatApplication(NSWorkspace.shared.frontmostApplication) {
      return
    }
    usleep(100_000)
  }
  fputs("无法将微信切到前台\n", stderr)
  exit(1)
}

func click(_ point: CGPoint) {
  let source = CGEventSource(stateID: .hidSystemState)
  source?.localEventsSuppressionInterval = 0
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(100_000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(80_000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func clickWithFreshProcess(_ point: CGPoint) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/swift")
  process.arguments = [
    CommandLine.arguments[0],
    "click-point-delayed",
    "\(Int(point.x.rounded()))",
    "\(Int(point.y.rounded()))",
  ]
  debugLog("click child args=\(process.arguments?.joined(separator: " ") ?? "")")
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fputs("无法点击微信会话：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  if process.terminationStatus != 0 {
    fputs("点击微信会话失败\n", stderr)
    exit(1)
  }
}

func clickSearch(_ bounds: CGRect) {
  click(CGPoint(x: bounds.origin.x + 152, y: bounds.origin.y + 27))
}

func waitForWindowSharingState(
  _ windowID: Int,
  timeout: TimeInterval = 5,
  condition: (Int) -> Bool
) -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if condition(windowSharingState(windowID)) {
      return true
    }
    usleep(100_000)
  }
  return condition(windowSharingState(windowID))
}

func beginScreenshotMode(in window: (id: Int, pid: pid_t, bounds: CGRect)) {
  activateWeChat()
  if windowSharingState(window.id) != 0 {
    return
  }
  let screenshotButton = CGPoint(
    x: window.bounds.origin.x + min(window.bounds.width - 32, 357),
    y: window.bounds.origin.y + window.bounds.height - 36
  )
  click(screenshotButton)
  if waitForWindowSharingState(window.id, condition: { $0 != 0 }) {
    usleep(300_000)
    return
  }
  postKey(53)
  fputs("无法启动微信内置截图，请确认群聊输入栏的截图按钮可用\n", stderr)
  exit(1)
}

func endScreenshotMode() {
  guard let window = mainWindow(), windowSharingState(window.id) != 0 else { return }
  postKey(53)
  _ = waitForWindowSharingState(window.id, timeout: 2, condition: { $0 == 0 })
}

func scrollChat(direction: String, in bounds: CGRect, lines: Int = 48, bursts: Int = 4) {
  activateWeChat()
  let source = CGEventSource(stateID: .hidSystemState)
  source?.localEventsSuppressionInterval = 0
  let point = CGPoint(x: bounds.origin.x + bounds.width * 0.68, y: bounds.origin.y + bounds.height * 0.52)
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(80_000)
  let lineDelta = Int32(lines)
  let delta = direction == "down" ? -lineDelta : lineDelta
  for _ in 0..<bursts {
    CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
    usleep(90_000)
  }
  usleep(500_000)
}

func resizeWindow(width: Int, height: Int, window: (id: Int, pid: pid_t, bounds: CGRect)) {
  activateWeChat()
  guard AXIsProcessTrusted() else {
    fputs("需要授予辅助功能权限后才能自动调整微信窗口大小\n", stderr)
    exit(1)
  }
  let appElement = AXUIElementCreateApplication(window.pid)
  var axWindowValue: CFTypeRef?
  var axResult = AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &axWindowValue)
  if axResult != .success || axWindowValue == nil {
    var windowsValue: CFTypeRef?
    axResult = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsValue)
    if axResult == .success,
       let windows = windowsValue as? [AXUIElement],
       let firstWindow = windows.first {
      axWindowValue = firstWindow
    }
  }
  guard let axWindowValue else {
    fputs("无法定位微信主窗口，不能自动调整大小\n", stderr)
    exit(1)
  }
  let axWindow = axWindowValue as! AXUIElement
  var position = CGPoint(x: window.bounds.origin.x, y: window.bounds.origin.y)
  var size = CGSize(width: max(CGFloat(width), window.bounds.width), height: max(CGFloat(height), window.bounds.height))
  guard let positionValue = AXValueCreate(.cgPoint, &position),
        let sizeValue = AXValueCreate(.cgSize, &size) else {
    fputs("无法生成微信窗口尺寸参数\n", stderr)
    exit(1)
  }
  AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, positionValue)
  let resizeResult = AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute as CFString, sizeValue)
  if resizeResult != .success {
    fputs("自动调整微信窗口大小失败：\(resizeResult.rawValue)\n", stderr)
    exit(1)
  }
  usleep(800_000)
}

func normalized(_ text: String) -> String {
  text.replacingOccurrences(of: " ", with: "")
    .replacingOccurrences(of: "\n", with: "")
    .replacingOccurrences(of: "…", with: "")
    .lowercased()
    .replacingOccurrences(of: "l", with: "i")
}

func commonPrefixLength(_ left: String, _ right: String) -> Int {
  var count = 0
  for (a, b) in zip(left, right) {
    if a != b { break }
    count += 1
  }
  return count
}

func textMatchesGroup(_ text: String, groupName: String) -> Bool {
  let candidate = normalized(text)
  let target = normalized(groupName)
  if candidate.isEmpty || target.isEmpty { return false }
  if candidate.contains(target) || target.contains(candidate) { return true }
  return commonPrefixLength(candidate, target) >= min(6, target.count)
}

func debugLog(_ message: String) {
  if ProcessInfo.processInfo.environment["WECHAT_WINDOW_DEBUG"] == "1" {
    fputs("\(message)\n", stderr)
  }
}

struct RecognizedWindowText {
  let text: String
  let rect: CGRect
}

func recognizeWindowText(in window: (id: Int, pid: pid_t, bounds: CGRect)) -> (size: CGSize, items: [RecognizedWindowText]) {
  let screenshotURL = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("easy-exam-wechat-window-\(window.id)-\(UUID().uuidString).png")
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l\(window.id)", screenshotURL.path]
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fputs("无法截图微信窗口用于定位会话列表：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  var captured = process.terminationStatus == 0 && FileManager.default.fileExists(atPath: screenshotURL.path)
  if !captured {
    let bounds = window.bounds
    let fallback = Process()
    fallback.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    fallback.arguments = [
      "-x",
      "-o",
      "-R\(Int(bounds.origin.x)),\(Int(bounds.origin.y)),\(Int(bounds.width)),\(Int(bounds.height))",
      screenshotURL.path,
    ]
    do {
      try fallback.run()
      fallback.waitUntilExit()
      captured = fallback.terminationStatus == 0 && FileManager.default.fileExists(atPath: screenshotURL.path)
    } catch {
      debugLog("window region screenshot fallback failed: \(error.localizedDescription)")
    }
  }
  guard captured,
        let source = CGImageSourceCreateWithURL(screenshotURL as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    try? FileManager.default.removeItem(at: screenshotURL)
    fputs("无法读取微信窗口截图用于定位会话列表\n", stderr)
    exit(1)
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do {
    try handler.perform([request])
  } catch {
    try? FileManager.default.removeItem(at: screenshotURL)
    fputs("无法识别微信会话列表文字：\(error.localizedDescription)\n", stderr)
    exit(1)
  }
  try? FileManager.default.removeItem(at: screenshotURL)

  let imageWidth = CGFloat(image.width)
  let imageHeight = CGFloat(image.height)
  let items = (request.results ?? []).compactMap { observation -> RecognizedWindowText? in
    guard let text = observation.topCandidates(1).first?.string else { return nil }
    let box = observation.boundingBox
    let rect = CGRect(
      x: box.minX * imageWidth,
      y: (1 - box.maxY) * imageHeight,
      width: box.width * imageWidth,
      height: box.height * imageHeight
    )
    return RecognizedWindowText(text: text, rect: rect)
  }
  return (CGSize(width: imageWidth, height: imageHeight), items)
}

func conversationTitleMatches(_ groupName: String, in window: (id: Int, pid: pid_t, bounds: CGRect)) -> Bool {
  let recognized = recognizeWindowText(in: window)
  return recognized.items.contains { item in
    textMatchesGroup(item.text, groupName: groupName)
      && item.rect.midX >= recognized.size.width * 0.35
      && item.rect.minY <= recognized.size.height * 0.18
  }
}

func clickVisibleConversation(
  _ groupName: String,
  in window: (id: Int, pid: pid_t, bounds: CGRect),
  clearSearch: Bool = false,
  searchResults: Bool = false
) -> Bool {
  let recognized = recognizeWindowText(in: window)
  let maxXRatio: CGFloat = searchResults ? 0.55 : 0.38
  let matches = recognized.items.filter { item in
    textMatchesGroup(item.text, groupName: groupName)
      && item.rect.minX >= recognized.size.width * 0.04
      && item.rect.maxX <= recognized.size.width * maxXRatio
      && item.rect.minY >= recognized.size.height * 0.05
  }
  guard let match = matches.min(by: { $0.rect.minY < $1.rect.minY }) else {
    return false
  }
  let scaleX = window.bounds.width / recognized.size.width
  let scaleY = window.bounds.height / recognized.size.height
  let point = CGPoint(
    x: window.bounds.origin.x + match.rect.midX * scaleX,
    y: window.bounds.origin.y + match.rect.midY * scaleY
  )
  debugLog("matched conversation text=\(match.text) rect=\(Int(match.rect.minX)),\(Int(match.rect.minY)),\(Int(match.rect.width)),\(Int(match.rect.height)) point=\(Int(point.x)),\(Int(point.y))")
  clickWithFreshProcess(point)
  if clearSearch {
    postKey(53)
    usleep(300_000)
  }
  return true
}

switch CommandLine.arguments.dropFirst().first ?? "info" {
case "info":
  let window = requireMainWindow()
  let bounds = window.bounds
  print("\(window.id),\(Int(bounds.origin.x)),\(Int(bounds.origin.y)),\(Int(bounds.width)),\(Int(bounds.height)),\(windowSharingState(window.id))")
case "click-search":
  let window = requireMainWindow()
  clickSearch(window.bounds)
case "begin-screenshot":
  beginScreenshotMode(in: requireMainWindow())
case "end-screenshot":
  endScreenshotMode()
case "scroll-chat":
  guard CommandLine.arguments.count >= 3 else {
    fputs("缺少滚动方向\n", stderr)
    exit(2)
  }
  let window = requireMainWindow()
  let lines = CommandLine.arguments.count >= 4 ? Int(CommandLine.arguments[3]) ?? 48 : 48
  let bursts = CommandLine.arguments.count >= 5 ? Int(CommandLine.arguments[4]) ?? 4 : 4
  scrollChat(direction: CommandLine.arguments[2], in: window.bounds, lines: lines, bursts: bursts)
case "resize-window":
  guard CommandLine.arguments.count >= 4,
        let width = Int(CommandLine.arguments[2]),
        let height = Int(CommandLine.arguments[3]) else {
    fputs("缺少目标窗口宽高\n", stderr)
    exit(2)
  }
  let window = requireMainWindow()
  resizeWindow(width: width, height: height, window: window)
case "click-point":
  guard CommandLine.arguments.count >= 4,
        let x = Double(CommandLine.arguments[2]),
        let y = Double(CommandLine.arguments[3]) else {
    fputs("缺少点击坐标\n", stderr)
    exit(2)
  }
  activateWeChat()
  click(CGPoint(x: x, y: y))
  usleep(500_000)
case "click-point-delayed":
  guard CommandLine.arguments.count >= 4,
        let x = Double(CommandLine.arguments[2]),
        let y = Double(CommandLine.arguments[3]) else {
    fputs("缺少点击坐标\n", stderr)
    exit(2)
  }
  usleep(800_000)
  activateWeChat()
  click(CGPoint(x: x, y: y))
  usleep(500_000)
case "open-group":
  guard CommandLine.arguments.count >= 3 else {
    fputs("缺少微信群名称\n", stderr)
    exit(2)
  }
  NSPasteboard.general.clearContents()
  NSPasteboard.general.setString(CommandLine.arguments[2], forType: .string)
  activateWeChat()
  usleep(500_000)
  postKey(53)
  usleep(300_000)
  guard let activeWindow = mainWindow() else {
    fputs("微信未登录或主聊天窗口不可见\n", stderr)
    exit(1)
  }
  clickSearch(activeWindow.bounds)
  postKey(0, flags: .maskCommand)
  postKey(9, flags: .maskCommand)
  usleep(800_000)
  postKey(36)
  usleep(1_200_000)
  postKey(53)
  usleep(300_000)
default:
  fputs("用法：swift scripts/wechat_window.swift [info|click-search|begin-screenshot|end-screenshot|scroll-chat up|down [lines] [bursts]|resize-window width height|open-group 群名]\n", stderr)
  exit(2)
}
