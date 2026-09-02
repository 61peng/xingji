import AppKit
import UniformTypeIdentifiers
import WebKit

final class LocalResourceSchemeHandler: NSObject, WKURLSchemeHandler {
    private let rootURL: URL

    init(rootURL: URL) {
        self.rootURL = rootURL.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        var relativePath = requestURL.path
        if relativePath.isEmpty || relativePath == "/" {
            relativePath = "/index.html"
        }
        relativePath = String(relativePath.drop(while: { $0 == "/" }))

        let fileURL = rootURL.appendingPathComponent(relativePath).standardizedFileURL
        guard fileURL.path.hasPrefix(rootURL.path + "/") else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let response = URLResponse(
                url: requestURL,
                mimeType: mimeType(for: fileURL.pathExtension),
                expectedContentLength: data.count,
                textEncodingName: isTextFile(fileURL.pathExtension) ? "utf-8" : nil
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func mimeType(for fileExtension: String) -> String {
        switch fileExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "webp": return "image/webp"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    private func isTextFile(_ fileExtension: String) -> Bool {
        ["html", "js", "mjs", "css", "json", "svg"].contains(fileExtension.lowercased())
    }
}

final class StorageBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let fileURL: URL

    override init() {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        let directory = support.appendingPathComponent("行迹", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        fileURL = directory.appendingPathComponent("journeys-v1.json")
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "无效的本地存储请求")
            return
        }

        switch action {
        case "read":
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                replyHandler(nil, nil)
                return
            }
            do {
                let data = try Data(contentsOf: fileURL)
                let object = try JSONSerialization.jsonObject(with: data)
                replyHandler(object, nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }

        case "write":
            guard let object = body["data"], JSONSerialization.isValidJSONObject(object) else {
                replyHandler(nil, "无法保存这份行程数据")
                return
            }
            do {
                let data = try JSONSerialization.data(
                    withJSONObject: object,
                    options: [.prettyPrinted, .sortedKeys]
                )
                try data.write(to: fileURL, options: .atomic)
                replyHandler(true, nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }

        case "export":
            guard let object = body["data"], JSONSerialization.isValidJSONObject(object) else {
                replyHandler(nil, "无法导出这份行程数据")
                return
            }
            do {
                let data = try JSONSerialization.data(
                    withJSONObject: object,
                    options: [.prettyPrinted, .sortedKeys]
                )
                let panel = NSSavePanel()
                panel.title = "导出行迹数据"
                panel.prompt = "导出"
                panel.canCreateDirectories = true
                panel.allowedContentTypes = [.json]
                panel.nameFieldStringValue =
                    (body["filename"] as? String) ?? "行迹数据.json"

                guard panel.runModal() == .OK, let destination = panel.url else {
                    replyHandler(false, nil)
                    return
                }
                try data.write(to: destination, options: .atomic)
                replyHandler(true, nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }

        case "import":
            let panel = NSOpenPanel()
            panel.title = "导入行迹数据"
            panel.prompt = "导入"
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = [.json]

            guard panel.runModal() == .OK, let source = panel.url else {
                replyHandler(nil, nil)
                return
            }
            do {
                let data = try Data(contentsOf: source)
                let object = try JSONSerialization.jsonObject(with: data)
                replyHandler(object, nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }

        default:
            replyHandler(nil, "不支持的本地存储操作")
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let storageBridge = StorageBridge()
    private var resourceSchemeHandler: LocalResourceSchemeHandler!

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenus()

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        guard let resourceURL = Bundle.main.resourceURL else {
            showLaunchError("找不到应用资源目录")
            return
        }
        let webDirectory = resourceURL.appendingPathComponent("web", isDirectory: true)
        resourceSchemeHandler = LocalResourceSchemeHandler(rootURL: webDirectory)
        configuration.setURLSchemeHandler(resourceSchemeHandler, forURLScheme: "xingji")
        configuration.userContentController.addScriptMessageHandler(
            storageBridge,
            contentWorld: .page,
            name: "xingjiStorage"
        )

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = true

        let initialSize = NSSize(width: 1280, height: 820)
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: initialSize),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "行迹"
        window.minSize = NSSize(width: 960, height: 680)
        window.titlebarAppearsTransparent = true
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        let indexURL = URL(string: "xingji://app/index.html")!
        webView.load(URLRequest(url: indexURL))

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "确认导入行迹数据"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "继续导入")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "行迹"
        alert.informativeText = message
        alert.addButton(withTitle: "知道了")
        alert.runModal()
        completionHandler()
    }

    private func configureMenus() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于行迹", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出行迹", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    private func showLaunchError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "无法打开行迹"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
    }
}

@main
enum XingjiApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}
