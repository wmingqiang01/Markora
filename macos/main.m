#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <CoreServices/CoreServices.h>
#include <math.h>

@interface MarkoraWindow : NSWindow
@property (nonatomic, strong) NSEvent *lastMouseDownEvent;
@property (nonatomic, assign) BOOL canDragWindow;
@property (nonatomic, assign) NSPoint mouseDownScreenPoint;
- (void)beginNativeDragFromLastMouseDown;
@end

@implementation MarkoraWindow

- (void)beginNativeDragFromLastMouseDown {
    NSEvent *down = self.lastMouseDownEvent;
    if (!down) return;
    self.canDragWindow = NO;

    // Hand off window move to macOS WindowServer (returns immediately)
    [self performWindowDragWithEvent:down];

    // Send a clean mouseUp to WKWebView so WebKit never stays in a stuck mouse-pressed/selection state
    NSEvent *syntheticUp = [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp
                                              location:down.locationInWindow
                                         modifierFlags:down.modifierFlags
                                             timestamp:NSProcessInfo.processInfo.systemUptime
                                          windowNumber:self.windowNumber
                                               context:nil
                                           eventNumber:down.eventNumber
                                            clickCount:down.clickCount
                                              pressure:0.0];
    if (syntheticUp) {
        [super sendEvent:syntheticUp];
    }
}

- (void)sendEvent:(NSEvent *)event {
    if (event.type == NSEventTypeLeftMouseDown) {
        self.lastMouseDownEvent = event;
        self.canDragWindow = NO;
        self.mouseDownScreenPoint = [NSEvent mouseLocation];
    } else if (event.type == NSEventTypeLeftMouseDragged) {
        if (self.canDragWindow && self.lastMouseDownEvent) {
            [self beginNativeDragFromLastMouseDown];
            return;
        }
    } else if (event.type == NSEventTypeLeftMouseUp) {
        self.canDragWindow = NO;
        self.lastMouseDownEvent = nil;
    }
    [super sendEvent:event];
}

@end

@interface MarkoraAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property (nonatomic, strong) MarkoraWindow *window;
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, copy) NSString *currentWorkspacePath;
@property (nonatomic, copy) NSString *pendingExternalFilePath;
@property (nonatomic, assign) BOOL webViewReady;
@property (nonatomic, assign) BOOL forceClosing;
@property (nonatomic, assign) BOOL cleanedUp;

// Live External File & Workspace Sync Watcher State
@property (nonatomic, assign) FSEventStreamRef fsEventStream;
@property (nonatomic, copy) NSArray<NSString *> *watchedStreamDirs;
@property (nonatomic, copy) NSString *watchedFilePath;
@property (nonatomic, copy) NSString *watchedFileStatSig;
@property (nonatomic, assign) unsigned long long watchedFileInode;
@property (nonatomic, copy) NSString *lastKnownFileContent;
@property (nonatomic, assign) BOOL watchedFileExisted;
@property (nonatomic, strong) NSData *lastKnownTreeJSON;
@property (nonatomic, strong) NSMutableSet<NSString *> *pendingAssetPaths;
@property (nonatomic, strong) NSTimer *fsDebounceTimer;
- (void)handleRawFSEventPaths:(NSArray<NSString *> *)paths;
@end

static void MarkoraFSEventsCallback(
    ConstFSEventStreamRef streamRef,
    void *clientCallBackInfo,
    size_t numEvents,
    void *eventPaths,
    const FSEventStreamEventFlags eventFlags[],
    const FSEventStreamEventId eventIds[]
) {
    (void)streamRef;
    (void)numEvents;
    (void)eventFlags;
    (void)eventIds;
    if (!clientCallBackInfo || !eventPaths) return;
    MarkoraAppDelegate *delegate = (__bridge MarkoraAppDelegate *)clientCallBackInfo;
    NSArray<NSString *> *paths = (__bridge NSArray<NSString *> *)eventPaths;
    [delegate handleRawFSEventPaths:paths];
}

@implementation MarkoraAppDelegate

- (NSString *)resolveDefaultWorkspacePath {
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL isDir = NO;

    // 1. Check user's last opened workspace folder in NSUserDefaults
    NSString *savedPath = [[NSUserDefaults standardUserDefaults] stringForKey:@"MarkoraLastWorkspacePath"];
    if (savedPath.length > 0 && [fm fileExistsAtPath:savedPath isDirectory:&isDir] && isDir) {
        return savedPath;
    }

    // 2. Check adjacent ../workspace when running from project folder
    NSString *bundlePath = [[NSBundle mainBundle] bundlePath];
    NSString *projectDir = [bundlePath stringByDeletingLastPathComponent];
    NSString *candidateWorkspace = [projectDir stringByAppendingPathComponent:@"workspace"];
    if ([fm fileExistsAtPath:candidateWorkspace isDirectory:&isDir] && isDir) {
        return candidateWorkspace;
    }

    // 3. Standalone installed mode (e.g. /Applications/Markora.app):
    // Create ~/Library/Application Support/Markora/Workspace and seed starter notes on first launch
    NSArray *appSupportDirs = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
    NSString *baseSupport = appSupportDirs.firstObject ?: [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support"];
    NSString *standaloneWS = [baseSupport stringByAppendingPathComponent:@"Markora/Workspace"];

    if (![fm fileExistsAtPath:standaloneWS isDirectory:&isDir]) {
        [fm createDirectoryAtPath:standaloneWS withIntermediateDirectories:YES attributes:nil error:nil];
        NSString *starterPath = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"starter_workspace"];
        if ([fm fileExistsAtPath:starterPath isDirectory:&isDir] && isDir) {
            NSArray *items = [fm contentsOfDirectoryAtPath:starterPath error:nil];
            for (NSString *item in items) {
                if ([item hasPrefix:@"."]) continue;
                [fm copyItemAtPath:[starterPath stringByAppendingPathComponent:item]
                            toPath:[standaloneWS stringByAppendingPathComponent:item]
                             error:nil];
            }
        }
    }
    return standaloneWS;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.pendingAssetPaths = [NSMutableSet set];
    self.currentWorkspacePath = [self resolveDefaultWorkspacePath];

    NSString *iconPath = [[NSBundle mainBundle] pathForResource:@"AppIcon" ofType:@"icns"];
    if (iconPath) {
        NSImage *appIcon = [[NSImage alloc] initWithContentsOfFile:iconPath];
        if (appIcon) {
            [NSApp setApplicationIconImage:appIcon];
        }
    }

    [self setupMainMenu];
    [self setupWindowAndWebView];
    [self rebuildFileSystemWatcher];
}

- (void)applicationDidBecomeActive:(NSNotification *)notification {
    if (self.webViewReady && !self.cleanedUp) {
        [self scheduleExternalChangesCheck];
    }
}

- (void)cleanupResources {
    if (self.cleanedUp) return;
    self.cleanedUp = YES;
    self.webViewReady = NO;

    if (self.fsDebounceTimer) {
        [self.fsDebounceTimer invalidate];
        self.fsDebounceTimer = nil;
    }
    if (self.fsEventStream != NULL) {
        FSEventStreamStop(self.fsEventStream);
        FSEventStreamInvalidate(self.fsEventStream);
        FSEventStreamRelease(self.fsEventStream);
        self.fsEventStream = NULL;
    }
    if (self.window) {
        self.window.lastMouseDownEvent = nil;
        self.window.delegate = nil;
    }
    if (self.webView) {
        self.webView.navigationDelegate = nil;
        [self.webView stopLoading];
        [self.webView.configuration.userContentController removeScriptMessageHandlerForName:@"markora"];
    }
}

- (void)windowWillClose:(NSNotification *)notification {
    [self cleanupResources];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self cleanupResources];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    self.webViewReady = YES;
    if (self.pendingExternalFilePath) {
        NSString *path = self.pendingExternalFilePath;
        self.pendingExternalFilePath = nil;
        [self openExternalMarkdownFile:path];
    }
}

- (void)application:(NSApplication *)sender openFiles:(NSArray<NSString *> *)filenames {
    NSString *firstPath = filenames.firstObject;
    if (!firstPath) {
        [sender replyToOpenOrPrint:NSApplicationDelegateReplyFailure];
        return;
    }
    if (self.webViewReady) {
        [self openExternalMarkdownFile:firstPath];
    } else {
        self.pendingExternalFilePath = firstPath;
    }
    [sender replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}

- (void)openExternalMarkdownFile:(NSString *)filePath {
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL isDir = NO;
    if (![fm fileExistsAtPath:filePath isDirectory:&isDir]) return;

    if (isDir) {
        self.currentWorkspacePath = filePath;
        [[NSUserDefaults standardUserDefaults] setObject:filePath forKey:@"MarkoraLastWorkspacePath"];
        NSArray *tree = [self scanDirectoryTree:filePath depth:0];
        [self trackWorkspaceTree:tree];
        NSDictionary *firstFile = [self findFirstMarkdownFile:tree];
        if (firstFile) {
            [self trackActiveFile:firstFile[@"path"] content:firstFile[@"content"]];
            [self pushExternalFileToJS:firstFile rootPath:filePath tree:tree];
        } else {
            [self rebuildFileSystemWatcher];
        }
        return;
    }

    NSString *parentDir = [filePath stringByDeletingLastPathComponent];
    self.currentWorkspacePath = parentDir;
    NSArray *tree = [self scanDirectoryTree:parentDir depth:0];
    [self trackWorkspaceTree:tree];
    NSString *content = [NSString stringWithContentsOfFile:filePath encoding:NSUTF8StringEncoding error:nil] ?: @"";
    [self trackActiveFile:filePath content:content];
    NSDictionary *fileObj = @{
        @"name": [filePath lastPathComponent],
        @"path": filePath,
        @"content": content
    };
    [self pushExternalFileToJS:fileObj rootPath:parentDir tree:tree];
}

- (void)pushExternalFileToJS:(NSDictionary *)fileObj rootPath:(NSString *)rootPath tree:(NSArray *)tree {
    if (self.cleanedUp || !self.webView) return;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@{
        @"rootPath": rootPath ?: @"",
        @"rootName": [rootPath lastPathComponent] ?: @"本地目录",
        @"tree": tree ?: @[],
        @"file": fileObj
    } options:0 error:nil];
    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__markoraOpenExternalFile && window.__markoraOpenExternalFile(%@);", jsonStr];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.cleanedUp && self.webView) {
            [self.webView evaluateJavaScript:js completionHandler:nil];
        }
    });
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if (!self.cleanedUp && self.window && self.window.isVisible && self.window.isDocumentEdited && !self.forceClosing) {
        BOOL canClose = [self windowShouldClose:self.window];
        if (!canClose) {
            return NSTerminateCancel;
        }
    }
    [self cleanupResources];
    return NSTerminateNow;
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    if (self.cleanedUp || !self.window.isDocumentEdited || self.forceClosing) {
        return YES;
    }

    NSAlert *alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleWarning;
    alert.messageText = @"是否保存对当前文档的修改？";
    alert.informativeText = @"如果不保存，您最近的更改将会丢失。";
    [alert addButtonWithTitle:@"保存"];
    [alert addButtonWithTitle:@"不保存"];
    [alert addButtonWithTitle:@"取消"];

    NSModalResponse resp = [alert runModal];
    if (resp == NSAlertFirstButtonReturn) {
        [self sendMenuCmdToJS:@"saveAndClose"];
        return NO;
    } else if (resp == NSAlertSecondButtonReturn) {
        self.forceClosing = YES;
        return YES;
    }
    return NO;
}

#pragma mark - Window & WebView Setup

- (void)setupWindowAndWebView {
    NSRect frame = NSMakeRect(0, 0, 1220, 800);
    NSUInteger styleMask = NSWindowStyleMaskTitled |
                           NSWindowStyleMaskClosable |
                           NSWindowStyleMaskMiniaturizable |
                           NSWindowStyleMaskResizable |
                           NSWindowStyleMaskFullSizeContentView;

    self.window = [[MarkoraWindow alloc] initWithContentRect:frame
                                                   styleMask:styleMask
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    // Crucial under ARC: prevent NSWindow from calling [self release] on close and causing double-free
    self.window.releasedWhenClosed = NO;
    self.window.title = @"Markora";
    self.window.titlebarAppearsTransparent = YES;
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.minSize = NSMakeSize(720, 480);
    self.window.delegate = self;
    if (![self.window setFrameUsingName:@"MarkoraMainWindow"]) {
        [self.window center];
    }
    [self.window setFrameAutosaveName:@"MarkoraMainWindow"];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKUserContentController *ucController = [[WKUserContentController alloc] init];
    [ucController addScriptMessageHandler:self name:@"markora"];
    config.userContentController = ucController;
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;

    [self.window.contentView addSubview:self.webView];

    // Load bundled or workspace src/index.html with local filesystem read access for relative assets
    NSString *bundlePath = [[NSBundle mainBundle] bundlePath];
    NSString *projectDir = [bundlePath stringByDeletingLastPathComponent];
    NSString *devHtmlPath = [projectDir stringByAppendingPathComponent:@"src/index.html"];
    NSString *bundledHtmlPath = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"app/index.html"];

    NSString *targetHtmlPath = [[NSFileManager defaultManager] fileExistsAtPath:devHtmlPath] ? devHtmlPath : bundledHtmlPath;
    NSURL *htmlURL = [NSURL fileURLWithPath:targetHtmlPath];
    NSURL *readAccessURL = [NSURL fileURLWithPath:@"/"];
    [self.webView loadFileURL:htmlURL allowingReadAccessToURL:readAccessURL];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

#pragma mark - Native Menu Bar

- (void)setupMainMenu {
    NSMenu *menubar = [[NSMenu alloc] init];
    [NSApp setMainMenu:menubar];

    // 1. App Menu
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Markora"];
    [appMenu addItemWithTitle:@"关于 Markora" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"隐藏 Markora" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"退出 Markora" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];

    // 2. File Menu
    NSMenuItem *fileMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:fileMenuItem];
    NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"文件"];
    [fileMenu addItemWithTitle:@"新建文档…" action:@selector(menuNewFile:) keyEquivalent:@"n"];
    [fileMenu addItemWithTitle:@"打开文件…" action:@selector(menuOpenFile:) keyEquivalent:@"o"];
    NSMenuItem *openFolderItem = [[NSMenuItem alloc] initWithTitle:@"选择工作区目录…" action:@selector(menuOpenFolder:) keyEquivalent:@"O"];
    openFolderItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [fileMenu addItem:openFolderItem];
    [fileMenu addItemWithTitle:@"快速跳转 / 全文搜索…" action:@selector(menuQuickOpen:) keyEquivalent:@"p"];
    NSMenuItem *historyItem = [[NSMenuItem alloc] initWithTitle:@"历史打开记录" action:@selector(menuShowHistory:) keyEquivalent:@"H"];
    historyItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [fileMenu addItem:historyItem];
    [fileMenu addItemWithTitle:@"在访达中显示当前目录" action:@selector(menuRevealInFinder:) keyEquivalent:@""];
    [fileMenu addItemWithTitle:@"重新从磁盘同步" action:@selector(menuReloadFromDisk:) keyEquivalent:@"r"];
    [fileMenu addItem:[NSMenuItem separatorItem]];
    [fileMenu addItemWithTitle:@"保存" action:@selector(menuSave:) keyEquivalent:@"s"];
    NSMenuItem *saveAsItem = [[NSMenuItem alloc] initWithTitle:@"另存为…" action:@selector(menuSaveAs:) keyEquivalent:@"S"];
    saveAsItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [fileMenu addItem:saveAsItem];
    [fileMenu addItem:[NSMenuItem separatorItem]];
    [fileMenu addItemWithTitle:@"导出为 HTML…" action:@selector(menuExportHTML:) keyEquivalent:@""];
    NSMenuItem *exportPdfItem = [[NSMenuItem alloc] initWithTitle:@"导出为 PDF…" action:@selector(menuExportPDF:) keyEquivalent:@"E"];
    exportPdfItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [fileMenu addItem:exportPdfItem];
    [fileMenuItem setSubmenu:fileMenu];

    // 3. Edit Menu (AST Undo/Redo + Standard Cut/Copy/Paste + Find/Replace)
    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
    [editMenu addItemWithTitle:@"撤销" action:@selector(menuUndo:) keyEquivalent:@"z"];
    NSMenuItem *redoItem = [[NSMenuItem alloc] initWithTitle:@"重做" action:@selector(menuRedo:) keyEquivalent:@"Z"];
    redoItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [editMenu addItem:redoItem];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"查找与替换…" action:@selector(menuFind:) keyEquivalent:@"f"];
    [editMenuItem setSubmenu:editMenu];

    // 4. View Menu
    NSMenuItem *viewMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:viewMenuItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"视图"];
    [viewMenu addItemWithTitle:@"切换源码模式" action:@selector(menuToggleSource:) keyEquivalent:@"/"];
    NSMenuItem *sidebarItem = [[NSMenuItem alloc] initWithTitle:@"显示/隐藏侧边栏" action:@selector(menuToggleSidebar:) keyEquivalent:@"L"];
    sidebarItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [viewMenu addItem:sidebarItem];
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItemWithTitle:@"专注模式 (Focus Mode)" action:@selector(menuToggleFocus:) keyEquivalent:@""];
    [viewMenu addItemWithTitle:@"打字机模式 (Typewriter Mode)" action:@selector(menuToggleTypewriter:) keyEquivalent:@""];
    [viewMenuItem setSubmenu:viewMenu];

    // 5. Theme Menu
    NSMenuItem *themeMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:themeMenuItem];
    NSMenu *themeMenu = [[NSMenu alloc] initWithTitle:@"主题"];
    [themeMenu addItemWithTitle:@"跟随系统外观 (Auto)" action:@selector(menuThemeAuto:) keyEquivalent:@""];
    [themeMenu addItem:[NSMenuItem separatorItem]];
    [themeMenu addItemWithTitle:@"GitHub Light (清爽亮色)" action:@selector(menuThemeLight:) keyEquivalent:@""];
    [themeMenu addItemWithTitle:@"Paper Warm (护眼暖纸)" action:@selector(menuThemeWarm:) keyEquivalent:@""];
    [themeMenu addItemWithTitle:@"Night Dark (深邃暗夜)" action:@selector(menuThemeDark:) keyEquivalent:@""];
    [themeMenu addItemWithTitle:@"Nord Minimal (北欧极简)" action:@selector(menuThemeNord:) keyEquivalent:@""];
    [themeMenuItem setSubmenu:themeMenu];
}

- (void)sendMenuCmdToJS:(NSString *)cmd {
    NSString *js = [NSString stringWithFormat:@"window.__markoraMenuCommand && window.__markoraMenuCommand('%@');", cmd];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (void)menuNewFile:(id)s { [self sendMenuCmdToJS:@"newFile"]; }
- (void)menuOpenFile:(id)s { [self sendMenuCmdToJS:@"openFile"]; }
- (void)menuOpenFolder:(id)s { [self sendMenuCmdToJS:@"openFolder"]; }
- (void)menuQuickOpen:(id)s { [self sendMenuCmdToJS:@"quickOpen"]; }
- (void)menuShowHistory:(id)s { [self sendMenuCmdToJS:@"showHistory"]; }
- (void)menuRevealInFinder:(id)s {
    if (self.currentWorkspacePath) {
        [[NSWorkspace sharedWorkspace] selectFile:nil inFileViewerRootedAtPath:self.currentWorkspacePath];
    }
}
- (void)menuReloadFromDisk:(id)s { [self sendMenuCmdToJS:@"reloadFromDisk"]; }
- (void)menuSave:(id)s { [self sendMenuCmdToJS:@"save"]; }
- (void)menuSaveAs:(id)s { [self sendMenuCmdToJS:@"saveAs"]; }
- (void)menuExportHTML:(id)s { [self sendMenuCmdToJS:@"exportHTML"]; }
- (void)menuExportPDF:(id)s { [self sendMenuCmdToJS:@"exportPDF"]; }
- (void)menuUndo:(id)s { [self sendMenuCmdToJS:@"undo"]; }
- (void)menuRedo:(id)s { [self sendMenuCmdToJS:@"redo"]; }
- (void)menuFind:(id)s { [self sendMenuCmdToJS:@"find"]; }
- (void)menuToggleSource:(id)s { [self sendMenuCmdToJS:@"toggleSource"]; }
- (void)menuToggleSidebar:(id)s { [self sendMenuCmdToJS:@"toggleSidebar"]; }
- (void)menuToggleFocus:(id)s { [self sendMenuCmdToJS:@"toggleFocus"]; }
- (void)menuToggleTypewriter:(id)s { [self sendMenuCmdToJS:@"toggleTypewriter"]; }
- (void)menuThemeAuto:(id)s { [self sendMenuCmdToJS:@"themeAuto"]; }
- (void)menuThemeLight:(id)s { [self sendMenuCmdToJS:@"themeLight"]; }
- (void)menuThemeWarm:(id)s { [self sendMenuCmdToJS:@"themeWarm"]; }
- (void)menuThemeDark:(id)s { [self sendMenuCmdToJS:@"themeDark"]; }
- (void)menuThemeNord:(id)s { [self sendMenuCmdToJS:@"themeNord"]; }

#pragma mark - File System Helpers

- (NSArray *)scanDirectoryTree:(NSString *)dirPath depth:(NSInteger)depth {
    if (depth > 4) return @[];
    NSFileManager *fm = [NSFileManager defaultManager];
    NSError *err = nil;
    NSArray *contents = [fm contentsOfDirectoryAtPath:dirPath error:&err];
    if (err || !contents) return @[];

    NSArray *sorted = [contents sortedArrayUsingSelector:@selector(localizedStandardCompare:)];
    NSMutableArray *folders = [NSMutableArray array];
    NSMutableArray *files = [NSMutableArray array];

    for (NSString *name in sorted) {
        if ([name hasPrefix:@"."] || [name isEqualToString:@"node_modules"]) continue;
        NSString *fullPath = [dirPath stringByAppendingPathComponent:name];
        BOOL isDir = NO;
        if ([fm fileExistsAtPath:fullPath isDirectory:&isDir]) {
            if (isDir) {
                NSArray *children = [self scanDirectoryTree:fullPath depth:depth + 1];
                [folders addObject:@{
                    @"name": name,
                    @"path": fullPath,
                    @"type": @"folder",
                    @"children": children
                }];
            } else {
                NSString *ext = [[name pathExtension] lowercaseString];
                if ([ext isEqualToString:@"md"] || [ext isEqualToString:@"markdown"] || [ext isEqualToString:@"txt"]) {
                    [files addObject:@{
                        @"name": name,
                        @"path": fullPath,
                        @"type": @"file"
                    }];
                }
            }
        }
    }

    return [folders arrayByAddingObjectsFromArray:files];
}

- (NSDictionary *)findFirstMarkdownFile:(NSArray *)tree {
    for (NSDictionary *item in tree) {
        if ([item[@"type"] isEqualToString:@"file"]) {
            NSString *p = item[@"path"];
            NSString *content = [NSString stringWithContentsOfFile:p encoding:NSUTF8StringEncoding error:nil] ?: @"";
            return @{
                @"name": item[@"name"],
                @"path": p,
                @"content": content
            };
        } else if ([item[@"type"] isEqualToString:@"folder"]) {
            NSDictionary *found = [self findFirstMarkdownFile:item[@"children"]];
            if (found) return found;
        }
    }
    return nil;
}

- (void)collectMarkdownFilesInDir:(NSString *)dirPath depth:(NSInteger)depth into:(NSMutableArray<NSString *> *)outPaths {
    if (depth > 4 || !dirPath || outPaths.count >= 500) return;
    NSFileManager *fm = [NSFileManager defaultManager];
    NSArray *contents = [fm contentsOfDirectoryAtPath:dirPath error:nil];
    if (!contents) return;
    NSArray *sorted = [contents sortedArrayUsingSelector:@selector(localizedStandardCompare:)];
    for (NSString *name in sorted) {
        if ([name hasPrefix:@"."] || [name isEqualToString:@"node_modules"]) continue;
        NSString *fullPath = [dirPath stringByAppendingPathComponent:name];
        BOOL isDir = NO;
        if ([fm fileExistsAtPath:fullPath isDirectory:&isDir]) {
            if (isDir) {
                [self collectMarkdownFilesInDir:fullPath depth:depth + 1 into:outPaths];
            } else {
                NSString *ext = [[name pathExtension] lowercaseString];
                if ([ext isEqualToString:@"md"] || [ext isEqualToString:@"markdown"] || [ext isEqualToString:@"txt"]) {
                    [outPaths addObject:fullPath];
                }
            }
        }
    }
}

#pragma mark - Live File System Watcher (FSEvents)

- (NSString *)statSignatureForPath:(NSString *)path inodeOut:(unsigned long long *)inodeOut {
    if (!path || path.length == 0) return @"";
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
    if (!attrs) return @"";
    NSTimeInterval mtime = [attrs[NSFileModificationDate] timeIntervalSince1970];
    unsigned long long size = [attrs[NSFileSize] unsignedLongLongValue];
    unsigned long long ino = [attrs[NSFileSystemFileNumber] unsignedLongLongValue];
    if (inodeOut) *inodeOut = ino;
    return [NSString stringWithFormat:@"%.6f:%llu:%llu", mtime, size, ino];
}

- (NSString *)findFileByInode:(unsigned long long)targetInode inTree:(NSArray *)tree {
    if (targetInode == 0 || !tree) return nil;
    NSFileManager *fm = [NSFileManager defaultManager];
    for (NSDictionary *item in tree) {
        if ([item[@"type"] isEqualToString:@"file"]) {
            NSString *p = item[@"path"];
            NSDictionary *attrs = [fm attributesOfItemAtPath:p error:nil];
            if (attrs && [attrs[NSFileSystemFileNumber] unsignedLongLongValue] == targetInode) {
                return p;
            }
        } else if ([item[@"type"] isEqualToString:@"folder"]) {
            NSString *found = [self findFileByInode:targetInode inTree:item[@"children"]];
            if (found) return found;
        }
    }
    return nil;
}

- (void)trackWorkspaceTree:(NSArray *)tree {
    NSData *treeJSON = [NSJSONSerialization dataWithJSONObject:(tree ?: @[]) options:0 error:nil];
    if (treeJSON) {
        self.lastKnownTreeJSON = treeJSON;
    }
    [self rebuildFileSystemWatcher];
}

- (void)trackActiveFile:(NSString *)filePath content:(NSString *)content {
    if (!filePath || filePath.length == 0) {
        self.watchedFilePath = @"";
        self.watchedFileStatSig = @"";
        self.watchedFileInode = 0;
        self.lastKnownFileContent = @"";
        self.watchedFileExisted = NO;
        [self rebuildFileSystemWatcher];
        return;
    }
    self.watchedFilePath = filePath;
    unsigned long long ino = 0;
    NSString *sig = [self statSignatureForPath:filePath inodeOut:&ino];
    self.watchedFileStatSig = sig;
    self.watchedFileInode = ino;
    self.watchedFileExisted = (sig.length > 0);
    if (content != nil) {
        self.lastKnownFileContent = content;
    } else if (self.watchedFileExisted) {
        self.lastKnownFileContent = [NSString stringWithContentsOfFile:filePath encoding:NSUTF8StringEncoding error:nil] ?: @"";
    }
    [self rebuildFileSystemWatcher];
}

- (void)rebuildFileSystemWatcher {
    NSMutableSet<NSString *> *dirSet = [NSMutableSet set];
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL isDir = NO;

    if (self.currentWorkspacePath.length > 0 && [fm fileExistsAtPath:self.currentWorkspacePath isDirectory:&isDir] && isDir) {
        [dirSet addObject:self.currentWorkspacePath];
        NSString *resolved = [self.currentWorkspacePath stringByResolvingSymlinksInPath];
        if (resolved.length > 0) [dirSet addObject:resolved];
    }

    if (self.watchedFilePath.length > 0) {
        NSString *parentDir = [self.watchedFilePath stringByDeletingLastPathComponent];
        if (parentDir.length > 0 && [fm fileExistsAtPath:parentDir isDirectory:&isDir] && isDir) {
            [dirSet addObject:parentDir];
            NSString *resolvedParent = [parentDir stringByResolvingSymlinksInPath];
            if (resolvedParent.length > 0) [dirSet addObject:resolvedParent];
        }
    }

    NSArray<NSString *> *sortedDirs = [[dirSet allObjects] sortedArrayUsingSelector:@selector(compare:)];
    if (self.fsEventStream != NULL && [sortedDirs isEqualToArray:self.watchedStreamDirs]) {
        return;
    }

    if (self.fsEventStream != NULL) {
        FSEventStreamStop(self.fsEventStream);
        FSEventStreamInvalidate(self.fsEventStream);
        FSEventStreamRelease(self.fsEventStream);
        self.fsEventStream = NULL;
    }

    self.watchedStreamDirs = sortedDirs;
    if (sortedDirs.count == 0) return;

    FSEventStreamContext ctx = { 0, (__bridge void *)self, NULL, NULL, NULL };
    FSEventStreamCreateFlags flags = kFSEventStreamCreateFlagUseCFTypes |
                                     kFSEventStreamCreateFlagFileEvents |
                                     kFSEventStreamCreateFlagNoDefer;
    self.fsEventStream = FSEventStreamCreate(
        NULL,
        &MarkoraFSEventsCallback,
        &ctx,
        (__bridge CFArrayRef)sortedDirs,
        kFSEventStreamEventIdSinceNow,
        0.10,
        flags
    );
    if (self.fsEventStream != NULL) {
        FSEventStreamSetDispatchQueue(self.fsEventStream, dispatch_get_main_queue());
        FSEventStreamStart(self.fsEventStream);
    }
}

- (void)handleRawFSEventPaths:(NSArray<NSString *> *)paths {
    BOOL hasRelevantEvent = NO;
    for (NSString *p in paths) {
        if (![p isKindOfClass:[NSString class]]) continue;
        if ([p containsString:@"/.git/"] || [p hasSuffix:@"/.DS_Store"]) continue;
        hasRelevantEvent = YES;
        NSString *ext = [[p pathExtension] lowercaseString];
        if ([ext isEqualToString:@"png"] || [ext isEqualToString:@"jpg"] ||
            [ext isEqualToString:@"jpeg"] || [ext isEqualToString:@"gif"] ||
            [ext isEqualToString:@"webp"] || [ext isEqualToString:@"svg"] ||
            [ext isEqualToString:@"bmp"]) {
            [self.pendingAssetPaths addObject:p];
        }
    }
    if (hasRelevantEvent) {
        [self scheduleExternalChangesCheck];
    }
}

- (void)scheduleExternalChangesCheck {
    [self.fsDebounceTimer invalidate];
    self.fsDebounceTimer = [NSTimer scheduledTimerWithTimeInterval:0.12
                                                            target:self
                                                          selector:@selector(performExternalChangesCheck)
                                                          userInfo:nil
                                                           repeats:NO];
}

- (NSString *)readMarkdownStringAtPath:(NSString *)path {
    if (!path || path.length == 0) return nil;
    NSError *err = nil;
    NSString *str = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:&err];
    if (!str && err) {
        NSStringEncoding usedEnc = NSUTF8StringEncoding;
        str = [NSString stringWithContentsOfFile:path usedEncoding:&usedEnc error:nil];
    }
    return str;
}

- (void)pushExternalSyncEvent:(NSDictionary *)eventObj {
    if (self.cleanedUp || !self.webViewReady || !self.webView || !eventObj) return;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:eventObj options:0 error:nil];
    if (!jsonData) return;
    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__markoraExternalSync && window.__markoraExternalSync(%@);", jsonStr];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.cleanedUp && self.webView) {
            [self.webView evaluateJavaScript:js completionHandler:nil];
        }
    });
}

- (void)performExternalChangesCheck {
    if (!self.webViewReady) return;
    NSFileManager *fm = [NSFileManager defaultManager];

    // 1. Check workspace directory tree changes first (also used for inode rename lookup)
    NSArray *latestTree = nil;
    BOOL treeDidChange = NO;
    if (self.currentWorkspacePath.length > 0) {
        latestTree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        NSData *treeJSON = [NSJSONSerialization dataWithJSONObject:(latestTree ?: @[]) options:0 error:nil];
        if (treeJSON && (!self.lastKnownTreeJSON || ![treeJSON isEqualToData:self.lastKnownTreeJSON])) {
            self.lastKnownTreeJSON = treeJSON;
            treeDidChange = YES;
        }
    }

    // 2. Check currently open document for external content edits, rename/move, or deletion
    if (self.watchedFilePath.length > 0) {
        BOOL exists = [fm fileExistsAtPath:self.watchedFilePath];
        if (!exists) {
            if (self.watchedFileExisted) {
                NSString *renamedPath = [self findFileByInode:self.watchedFileInode inTree:latestTree];
                if (renamedPath.length > 0) {
                    NSString *oldPath = self.watchedFilePath;
                    NSString *diskContent = [self readMarkdownStringAtPath:renamedPath] ?: self.lastKnownFileContent ?: @"";
                    [self trackActiveFile:renamedPath content:diskContent];
                    treeDidChange = NO; // Included in fileRenamed payload
                    [self pushExternalSyncEvent:@{
                        @"type": @"fileRenamed",
                        @"oldPath": oldPath,
                        @"newPath": renamedPath,
                        @"newName": [renamedPath lastPathComponent],
                        @"content": diskContent,
                        @"tree": latestTree ?: @[]
                    }];
                } else {
                    self.watchedFileExisted = NO;
                    self.watchedFileStatSig = @"";
                    treeDidChange = NO; // Included in fileDeleted payload
                    [self pushExternalSyncEvent:@{
                        @"type": @"fileDeleted",
                        @"path": self.watchedFilePath,
                        @"tree": latestTree ?: @[]
                    }];
                }
            }
        } else {
            unsigned long long ino = 0;
            NSString *sig = [self statSignatureForPath:self.watchedFilePath inodeOut:&ino];
            BOOL reappeared = !self.watchedFileExisted;
            self.watchedFileExisted = YES;
            if (ino != 0) self.watchedFileInode = ino;

            if (reappeared || ![sig isEqualToString:self.watchedFileStatSig]) {
                self.watchedFileStatSig = sig;
                NSString *diskContent = [self readMarkdownStringAtPath:self.watchedFilePath];
                if (diskContent != nil && (!self.lastKnownFileContent || ![diskContent isEqualToString:self.lastKnownFileContent])) {
                    self.lastKnownFileContent = diskContent;
                    [self pushExternalSyncEvent:@{
                        @"type": @"fileModified",
                        @"path": self.watchedFilePath,
                        @"name": [self.watchedFilePath lastPathComponent],
                        @"content": diskContent
                    }];
                }
            }
        }
    }

    // 3. Push sidebar file tree update if structure changed independently
    if (treeDidChange && latestTree != nil) {
        [self pushExternalSyncEvent:@{
            @"type": @"treeChanged",
            @"rootPath": self.currentWorkspacePath ?: @"",
            @"tree": latestTree
        }];
    }

    // 4. Push image asset refresh event if local images were modified externally
    if (self.pendingAssetPaths.count > 0) {
        NSArray *changedAssets = [self.pendingAssetPaths allObjects];
        [self.pendingAssetPaths removeAllObjects];
        [self pushExternalSyncEvent:@{
            @"type": @"assetsChanged",
            @"paths": changedAssets,
            @"ts": @((long long)([[NSDate date] timeIntervalSince1970] * 1000))
        }];
    }
}

#pragma mark - WKScriptMessageHandler Bridge

- (void)replyToJS:(NSNumber *)reqId ok:(BOOL)ok data:(id)data error:(NSString *)errorMsg {
    if (self.cleanedUp || !self.webView) return;
    id safeData = data ?: [NSNull null];
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@{
        @"ok": @(ok),
        @"data": safeData,
        @"error": errorMsg ?: @""
    } options:0 error:nil];
    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"(function(){ const r = %@; window.__markoraNativeCallback(%@, r.ok, r.data, r.error); })();", jsonStr, reqId];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.cleanedUp && self.webView) {
            [self.webView evaluateJavaScript:js completionHandler:nil];
        }
    });
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *body = (NSDictionary *)message.body;
    NSNumber *reqId = body[@"reqId"] ?: @(0);
    NSString *action = body[@"action"] ?: @"";
    NSDictionary *payload = [body[@"payload"] isKindOfClass:[NSDictionary class]] ? body[@"payload"] : @{};

    if ([action isEqualToString:@"armWindowDrag"]) {
        if (([NSEvent pressedMouseButtons] & 1) != 0 && self.window.lastMouseDownEvent) {
            NSPoint curr = [NSEvent mouseLocation];
            NSPoint start = self.window.mouseDownScreenPoint;
            if (hypot(curr.x - start.x, curr.y - start.y) >= 1.5) {
                [self.window beginNativeDragFromLastMouseDown];
            } else {
                self.window.canDragWindow = YES;
            }
        }
        return;
    }

    if ([action isEqualToString:@"zoomWindow"]) {
        [self.window zoom:nil];
        return;
    }

    if ([action isEqualToString:@"getInitialWorkspace"]) {
        NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        [self trackWorkspaceTree:tree];
        NSDictionary *initialFile = [self findFirstMarkdownFile:tree];
        if (initialFile) {
            [self trackActiveFile:initialFile[@"path"] content:initialFile[@"content"]];
        }
        [self replyToJS:reqId ok:YES data:@{
            @"rootPath": self.currentWorkspacePath,
            @"rootName": [self.currentWorkspacePath lastPathComponent],
            @"homeDir": NSHomeDirectory(),
            @"tree": tree,
            @"initialFile": initialFile ?: [NSNull null]
        } error:nil];
        return;
    }

    if ([action isEqualToString:@"openFolderDialog"]) {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.canChooseDirectories = YES;
        panel.canChooseFiles = NO;
        panel.allowsMultipleSelection = NO;
        panel.prompt = @"选择目录";
        if ([panel runModal] == NSModalResponseOK && panel.URL) {
            self.currentWorkspacePath = panel.URL.path;
            [[NSUserDefaults standardUserDefaults] setObject:self.currentWorkspacePath forKey:@"MarkoraLastWorkspacePath"];
            NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
            [self trackWorkspaceTree:tree];
            NSDictionary *initialFile = [self findFirstMarkdownFile:tree];
            if (initialFile) {
                [self trackActiveFile:initialFile[@"path"] content:initialFile[@"content"]];
            } else {
                [self trackActiveFile:@"" content:@""];
            }
            [self replyToJS:reqId ok:YES data:@{
                @"rootPath": self.currentWorkspacePath,
                @"rootName": [self.currentWorkspacePath lastPathComponent],
                @"homeDir": NSHomeDirectory(),
                @"tree": tree,
                @"initialFile": initialFile ?: [NSNull null]
            } error:nil];
        } else {
            [self replyToJS:reqId ok:YES data:[NSNull null] error:nil];
        }
        return;
    }

    if ([action isEqualToString:@"openFolderByPath"]) {
        NSString *targetDir = payload[@"path"] ?: @"";
        NSFileManager *fm = [NSFileManager defaultManager];
        BOOL isDir = NO;
        if (targetDir.length == 0 || ![fm fileExistsAtPath:targetDir isDirectory:&isDir] || !isDir) {
            [self replyToJS:reqId ok:NO data:nil error:@"目录不存在或已被移动"];
            return;
        }
        self.currentWorkspacePath = targetDir;
        [[NSUserDefaults standardUserDefaults] setObject:self.currentWorkspacePath forKey:@"MarkoraLastWorkspacePath"];
        NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        [self trackWorkspaceTree:tree];
        NSDictionary *initialFile = [self findFirstMarkdownFile:tree];
        if (initialFile) {
            [self trackActiveFile:initialFile[@"path"] content:initialFile[@"content"]];
        } else {
            [self trackActiveFile:@"" content:@""];
        }
        [self replyToJS:reqId ok:YES data:@{
            @"rootPath": self.currentWorkspacePath,
            @"rootName": [self.currentWorkspacePath lastPathComponent],
            @"homeDir": NSHomeDirectory(),
            @"tree": tree,
            @"initialFile": initialFile ?: [NSNull null]
        } error:nil];
        return;
    }

    if ([action isEqualToString:@"watchState"]) {
        NSString *rootPath = payload[@"rootPath"];
        if ([rootPath isKindOfClass:[NSString class]] && rootPath.length > 0 && ![rootPath isEqualToString:@"/workspace"]) {
            self.currentWorkspacePath = rootPath;
        }
        NSString *filePath = [payload[@"filePath"] isKindOfClass:[NSString class]] ? payload[@"filePath"] : @"";
        NSString *content = [payload[@"content"] isKindOfClass:[NSString class]] ? payload[@"content"] : nil;
        [self trackActiveFile:filePath content:content];
        [self replyToJS:reqId ok:YES data:@{ @"ok": @YES } error:nil];
        return;
    }

    if ([action isEqualToString:@"reloadWorkspaceAndFile"]) {
        NSArray *tree = self.currentWorkspacePath.length > 0
            ? [self scanDirectoryTree:self.currentWorkspacePath depth:0]
            : @[];
        [self trackWorkspaceTree:tree];

        NSString *fp = [payload[@"filePath"] isKindOfClass:[NSString class]] ? payload[@"filePath"] : self.watchedFilePath;
        id fileObj = [NSNull null];
        if (fp.length > 0 && [[NSFileManager defaultManager] fileExistsAtPath:fp]) {
            NSString *diskContent = [self readMarkdownStringAtPath:fp] ?: @"";
            [self trackActiveFile:fp content:diskContent];
            fileObj = @{
                @"path": fp,
                @"name": [fp lastPathComponent],
                @"content": diskContent
            };
        }
        [self replyToJS:reqId ok:YES data:@{
            @"tree": tree,
            @"file": fileObj
        } error:nil];
        return;
    }

    if ([action isEqualToString:@"revealInFinder"]) {
        NSString *p = payload[@"path"] ?: self.currentWorkspacePath;
        if (p.length > 0) {
            BOOL isDir = NO;
            if ([[NSFileManager defaultManager] fileExistsAtPath:p isDirectory:&isDir]) {
                if (isDir) {
                    [[NSWorkspace sharedWorkspace] selectFile:nil inFileViewerRootedAtPath:p];
                } else {
                    [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[[NSURL fileURLWithPath:p]]];
                }
            }
        }
        [self replyToJS:reqId ok:YES data:@{ @"ok": @YES } error:nil];
        return;
    }

    if ([action isEqualToString:@"getHistory"]) {
        NSString *jsonStr = [[NSUserDefaults standardUserDefaults] stringForKey:@"MarkoraRecentHistoryJSON"] ?: @"";
        [self replyToJS:reqId ok:YES data:@{
            @"json": jsonStr,
            @"homeDir": NSHomeDirectory()
        } error:nil];
        return;
    }

    if ([action isEqualToString:@"saveHistory"]) {
        NSString *jsonStr = payload[@"json"] ?: @"";
        [[NSUserDefaults standardUserDefaults] setObject:jsonStr forKey:@"MarkoraRecentHistoryJSON"];
        [self replyToJS:reqId ok:YES data:@{ @"ok": @YES } error:nil];
        return;
    }

    if ([action isEqualToString:@"openFileDialog"]) {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.canChooseDirectories = NO;
        panel.canChooseFiles = YES;
        panel.allowsMultipleSelection = NO;
        if ([panel runModal] == NSModalResponseOK && panel.URL) {
            NSString *p = panel.URL.path;
            NSString *content = [NSString stringWithContentsOfFile:p encoding:NSUTF8StringEncoding error:nil] ?: @"";
            [self replyToJS:reqId ok:YES data:@{
                @"path": p,
                @"name": [p lastPathComponent],
                @"content": content
            } error:nil];
        } else {
            [self replyToJS:reqId ok:YES data:[NSNull null] error:nil];
        }
        return;
    }

    if ([action isEqualToString:@"readFile"]) {
        NSString *p = payload[@"path"] ?: @"";
        NSError *err = nil;
        NSString *content = [NSString stringWithContentsOfFile:p encoding:NSUTF8StringEncoding error:&err];
        if (err) {
            [self replyToJS:reqId ok:NO data:nil error:err.localizedDescription];
        } else {
            [self replyToJS:reqId ok:YES data:@{
                @"path": p,
                @"name": [p lastPathComponent],
                @"content": content ?: @""
            } error:nil];
        }
        return;
    }

    if ([action isEqualToString:@"writeFile"]) {
        NSString *p = payload[@"path"] ?: @"";
        NSString *content = payload[@"content"] ?: @"";
        NSError *err = nil;
        [content writeToFile:p atomically:YES encoding:NSUTF8StringEncoding error:&err];
        if (err) {
            [self replyToJS:reqId ok:NO data:nil error:err.localizedDescription];
        } else {
            if ([p isEqualToString:self.watchedFilePath] || self.watchedFilePath.length == 0) {
                [self trackActiveFile:p content:content];
            }
            [self replyToJS:reqId ok:YES data:@{ @"ok": @YES, @"path": p } error:nil];
        }
        return;
    }

    if ([action isEqualToString:@"createFile"]) {
        NSString *folder = payload[@"folderPath"] ?: self.currentWorkspacePath;
        if (folder.length == 0) folder = self.currentWorkspacePath;
        NSString *fileName = payload[@"fileName"] ?: @"未命名.md";
        if ([fileName pathExtension].length == 0) {
            fileName = [fileName stringByAppendingString:@".md"];
        }
        NSString *fullPath = [folder stringByAppendingPathComponent:fileName];
        NSString *title = [fileName stringByDeletingPathExtension];
        NSString *customContent = payload[@"content"];
        NSString *initialContent = (customContent && [customContent length] > 0)
            ? customContent
            : [NSString stringWithFormat:@"# %@\n\n", title];
        NSError *err = nil;
        [initialContent writeToFile:fullPath atomically:YES encoding:NSUTF8StringEncoding error:&err];
        NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        if (!err) {
            [self trackWorkspaceTree:tree];
            [self trackActiveFile:fullPath content:initialContent];
        }
        [self replyToJS:reqId ok:(err == nil) data:@{
            @"file": @{
                @"name": fileName,
                @"path": fullPath,
                @"content": initialContent
            },
            @"tree": tree
        } error:err.localizedDescription];
        return;
    }

    if ([action isEqualToString:@"createFolder"]) {
        NSString *parentPath = payload[@"parentPath"] ?: self.currentWorkspacePath;
        if (parentPath.length == 0) parentPath = self.currentWorkspacePath;
        NSString *folderName = [payload[@"folderName"] ?: @"新建文件夹" stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (folderName.length == 0) folderName = @"新建文件夹";
        NSString *fullPath = [parentPath stringByAppendingPathComponent:folderName];
        NSError *err = nil;
        [[NSFileManager defaultManager] createDirectoryAtPath:fullPath withIntermediateDirectories:YES attributes:nil error:&err];
        NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        if (!err) {
            [self trackWorkspaceTree:tree];
        }
        [self replyToJS:reqId ok:(err == nil) data:@{
            @"ok": @(err == nil),
            @"folderPath": fullPath,
            @"tree": tree
        } error:err.localizedDescription];
        return;
    }

    if ([action isEqualToString:@"renameFile"]) {
        NSString *oldPath = payload[@"oldPath"] ?: @"";
        NSString *newName = [payload[@"newName"] ?: @"" stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        NSFileManager *fm = [NSFileManager defaultManager];
        BOOL isDir = NO;
        if (oldPath.length == 0 || newName.length == 0 || ![fm fileExistsAtPath:oldPath isDirectory:&isDir]) {
            [self replyToJS:reqId ok:NO data:nil error:@"原路径无效或名称为空"];
            return;
        }
        if (!isDir && [newName pathExtension].length == 0) {
            NSString *oldExt = [oldPath pathExtension];
            newName = [newName stringByAppendingPathExtension:(oldExt.length > 0 ? oldExt : @"md")];
        }
        NSString *parentDir = [oldPath stringByDeletingLastPathComponent];
        NSString *newPath = [parentDir stringByAppendingPathComponent:newName];
        NSError *err = nil;
        if (![newPath isEqualToString:oldPath]) {
            [fm moveItemAtPath:oldPath toPath:newPath error:&err];
        }
        NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        if (!err) {
            [self trackWorkspaceTree:tree];
            if (!isDir && [self.watchedFilePath isEqualToString:oldPath]) {
                [self trackActiveFile:newPath content:self.lastKnownFileContent];
            } else if (isDir && [self.watchedFilePath hasPrefix:[oldPath stringByAppendingString:@"/"]]) {
                NSString *movedWatched = [newPath stringByAppendingString:[self.watchedFilePath substringFromIndex:oldPath.length]];
                [self trackActiveFile:movedWatched content:self.lastKnownFileContent];
            }
        }
        [self replyToJS:reqId ok:(err == nil) data:@{
            @"ok": @(err == nil),
            @"newPath": newPath,
            @"newName": newName,
            @"isDir": @(isDir),
            @"tree": tree
        } error:err.localizedDescription];
        return;
    }

    if ([action isEqualToString:@"deleteFile"]) {
        NSString *p = payload[@"path"] ?: @"";
        NSError *err = nil;
        if (p.length > 0) {
            NSURL *targetURL = [NSURL fileURLWithPath:p];
            [[NSFileManager defaultManager] trashItemAtURL:targetURL resultingItemURL:nil error:&err];
        }
        NSArray *tree = [self scanDirectoryTree:self.currentWorkspacePath depth:0];
        if (!err) {
            [self trackWorkspaceTree:tree];
            if ([self.watchedFilePath isEqualToString:p] || [self.watchedFilePath hasPrefix:[p stringByAppendingString:@"/"]]) {
                [self trackActiveFile:@"" content:@""];
            }
        }
        [self replyToJS:reqId ok:(err == nil) data:@{
            @"ok": @(err == nil),
            @"tree": tree
        } error:err.localizedDescription];
        return;
    }

    if ([action isEqualToString:@"saveImageAsset"]) {
        NSString *mdFilePath = payload[@"mdFilePath"] ?: @"";
        NSString *rawName = payload[@"fileName"] ?: @"image.png";
        NSString *base64Str = payload[@"base64Data"] ?: @"";
        NSRange commaRange = [base64Str rangeOfString:@","];
        if (commaRange.location != NSNotFound) {
            base64Str = [base64Str substringFromIndex:commaRange.location + 1];
        }
        NSData *imgData = [[NSData alloc] initWithBase64EncodedString:base64Str options:NSDataBase64DecodingIgnoreUnknownCharacters];
        if (!imgData || imgData.length == 0) {
            [self replyToJS:reqId ok:NO data:nil error:@"图片数据解析失败"];
            return;
        }
        NSString *baseDir = mdFilePath.length > 0 ? [mdFilePath stringByDeletingLastPathComponent] : self.currentWorkspacePath;
        if (baseDir.length == 0) baseDir = NSTemporaryDirectory();
        NSString *assetsDir = [baseDir stringByAppendingPathComponent:@"assets"];
        NSFileManager *fm = [NSFileManager defaultManager];
        NSError *err = nil;
        [fm createDirectoryAtPath:assetsDir withIntermediateDirectories:YES attributes:nil error:&err];

        NSString *ext = [[rawName pathExtension] lowercaseString];
        if (ext.length == 0) ext = @"png";
        NSString *stem = [[rawName stringByDeletingPathExtension] stringByReplacingOccurrencesOfString:@"/" withString:@"-"];
        stem = [stem stringByReplacingOccurrencesOfString:@" " withString:@"-"];
        if (stem.length == 0) stem = @"image";

        NSString *finalName = [NSString stringWithFormat:@"%@.%@", stem, ext];
        NSString *destPath = [assetsDir stringByAppendingPathComponent:finalName];
        NSInteger suffix = 1;
        while ([fm fileExistsAtPath:destPath]) {
            finalName = [NSString stringWithFormat:@"%@-%ld.%@", stem, (long)suffix++, ext];
            destPath = [assetsDir stringByAppendingPathComponent:finalName];
        }

        BOOL written = [imgData writeToFile:destPath options:NSDataWritingAtomic error:&err];
        if (!written || err) {
            [self replyToJS:reqId ok:NO data:nil error:(err.localizedDescription ?: @"写入图片文件失败")];
            return;
        }
        NSString *relPath = [NSString stringWithFormat:@"assets/%@", finalName];
        [self replyToJS:reqId ok:YES data:@{
            @"ok": @YES,
            @"relativePath": relPath,
            @"fullPath": destPath,
            @"fileName": finalName
        } error:nil];
        return;
    }

    if ([action isEqualToString:@"searchWorkspace"]) {
        NSString *query = [payload[@"query"] ?: @"" stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        NSMutableArray<NSString *> *allFiles = [NSMutableArray array];
        [self collectMarkdownFilesInDir:self.currentWorkspacePath depth:0 into:allFiles];

        NSMutableArray *results = [NSMutableArray array];
        NSString *wsPrefix = [self.currentWorkspacePath hasSuffix:@"/"]
            ? self.currentWorkspacePath
            : [self.currentWorkspacePath stringByAppendingString:@"/"];

        if (query.length == 0) {
            for (NSString *fp in allFiles) {
                if (results.count >= 40) break;
                NSString *rel = [fp hasPrefix:wsPrefix] ? [fp substringFromIndex:wsPrefix.length] : [fp lastPathComponent];
                [results addObject:@{
                    @"path": fp,
                    @"name": [fp lastPathComponent],
                    @"relPath": rel,
                    @"line": @(0),
                    @"snippet": @"",
                    @"matchType": @"file"
                }];
            }
        } else {
            // 1. Filename / relative path matches first
            for (NSString *fp in allFiles) {
                if (results.count >= 60) break;
                NSString *rel = [fp hasPrefix:wsPrefix] ? [fp substringFromIndex:wsPrefix.length] : [fp lastPathComponent];
                if ([rel rangeOfString:query options:NSCaseInsensitiveSearch].location != NSNotFound) {
                    [results addObject:@{
                        @"path": fp,
                        @"name": [fp lastPathComponent],
                        @"relPath": rel,
                        @"line": @(0),
                        @"snippet": @"文件名匹配",
                        @"matchType": @"file"
                    }];
                }
            }
            // 2. Full-text content line matches
            for (NSString *fp in allFiles) {
                if (results.count >= 60) break;
                NSString *content = [NSString stringWithContentsOfFile:fp encoding:NSUTF8StringEncoding error:nil];
                if (!content) continue;
                if ([content rangeOfString:query options:NSCaseInsensitiveSearch].location == NSNotFound) continue;
                NSString *rel = [fp hasPrefix:wsPrefix] ? [fp substringFromIndex:wsPrefix.length] : [fp lastPathComponent];
                NSArray<NSString *> *lines = [content componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]];
                NSInteger perFileHits = 0;
                for (NSUInteger idx = 0; idx < lines.count; idx++) {
                    if (results.count >= 60 || perFileHits >= 5) break;
                    NSString *ln = lines[idx];
                    if ([ln rangeOfString:query options:NSCaseInsensitiveSearch].location != NSNotFound) {
                        NSString *trimmed = [ln stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
                        if (trimmed.length > 120) {
                            trimmed = [[trimmed substringToIndex:120] stringByAppendingString:@"…"];
                        }
                        [results addObject:@{
                            @"path": fp,
                            @"name": [fp lastPathComponent],
                            @"relPath": rel,
                            @"line": @(idx + 1),
                            @"snippet": trimmed,
                            @"matchType": @"content"
                        }];
                        perFileHits++;
                    }
                }
            }
        }
        [self replyToJS:reqId ok:YES data:@{ @"results": results } error:nil];
        return;
    }

    if ([action isEqualToString:@"forceCloseWindow"]) {
        self.forceClosing = YES;
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.window close];
        });
        [self replyToJS:reqId ok:YES data:@{ @"ok": @YES } error:nil];
        return;
    }

    if ([action isEqualToString:@"saveFileAs"] || [action isEqualToString:@"exportHTML"]) {
        NSString *defaultName = payload[@"defaultName"] ?: @"document.md";
        NSString *content = payload[@"content"] ?: @"";
        NSSavePanel *panel = [NSSavePanel savePanel];
        panel.nameFieldStringValue = defaultName;
        if ([panel runModal] == NSModalResponseOK && panel.URL) {
            NSError *err = nil;
            [content writeToURL:panel.URL atomically:YES encoding:NSUTF8StringEncoding error:&err];
            [self replyToJS:reqId ok:(err == nil) data:@{
                @"ok": @(err == nil),
                @"path": panel.URL.path,
                @"name": [panel.URL.path lastPathComponent]
            } error:err.localizedDescription];
        } else {
            [self replyToJS:reqId ok:YES data:@{ @"ok": @NO } error:nil];
        }
        return;
    }

    if ([action isEqualToString:@"exportPDF"]) {
        NSString *defaultName = payload[@"defaultName"] ?: @"document.pdf";
        NSSavePanel *panel = [NSSavePanel savePanel];
        panel.nameFieldStringValue = defaultName;
        if ([panel runModal] == NSModalResponseOK && panel.URL) {
            NSURL *saveURL = panel.URL;
            if (@available(macOS 11.0, *)) {
                WKPDFConfiguration *pdfConfig = [[WKPDFConfiguration alloc] init];
                [self.webView createPDFWithConfiguration:pdfConfig completionHandler:^(NSData *pdfDocumentData, NSError *error) {
                    if (pdfDocumentData && !error) {
                        [pdfDocumentData writeToURL:saveURL atomically:YES];
                        [self replyToJS:reqId ok:YES data:@{ @"ok": @YES, @"path": saveURL.path } error:nil];
                    } else {
                        [self replyToJS:reqId ok:NO data:nil error:error.localizedDescription];
                    }
                }];
            } else {
                [self replyToJS:reqId ok:NO data:nil error:@"macOS 11.0+ required for PDF export"];
            }
        } else {
            [self replyToJS:reqId ok:YES data:@{ @"ok": @NO } error:nil];
        }
        return;
    }

    if ([action isEqualToString:@"setWindowTitle"]) {
        NSString *title = payload[@"title"] ?: @"Markora";
        BOOL isEdited = [payload[@"isEdited"] boolValue];
        self.window.title = [NSString stringWithFormat:@"%@%@ — Markora", isEdited ? @"● " : @"", title];
        [self.window setDocumentEdited:isEdited];
        [self replyToJS:reqId ok:YES data:@{ @"ok": @YES } error:nil];
        return;
    }

    [self replyToJS:reqId ok:NO data:nil error:@"Unknown action"];
}

@end

static MarkoraAppDelegate *sAppDelegate = nil;

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        sAppDelegate = [[MarkoraAppDelegate alloc] init];
        [app setDelegate:sAppDelegate];
        [app run];
    }
    return 0;
}
