#import <Cocoa/Cocoa.h>
#include <string.h>

@interface HudDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSTask *worker;
@end
@implementation HudDelegate
- (NSTask *)taskWithArguments:(NSArray *)arguments {
    NSString *root = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"hud"];
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"runtime/node"]];
    task.arguments = [@[[root stringByAppendingPathComponent:@"launcher-macos.mjs"]] arrayByAddingObjectsFromArray:arguments];
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    return task;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSMenu *menu = [[NSMenu alloc] init];
    NSMenuItem *application = [[NSMenuItem alloc] init];
    NSMenu *items = [[NSMenu alloc] initWithTitle:@"Codex Composer HUD"];
    [items addItemWithTitle:@"표시기 종료" action:@selector(terminate:) keyEquivalent:@"q"];
    application.submenu = items; [menu addItem:application]; NSApp.mainMenu = menu;
    self.worker = [self taskWithArguments:@[]];
    NSError *error = nil;
    if (![self.worker launchAndReturnError:&error]) {
        NSAlert *alert = [[NSAlert alloc] init]; alert.messageText = @"표시기를 실행할 수 없습니다.";
        alert.informativeText = error.localizedDescription; [alert runModal]; [NSApp terminate:nil];
    }
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)application {
    NSTask *stop = [self taskWithArguments:@[@"--stop"]];
    if ([stop launchAndReturnError:NULL]) [stop waitUntilExit];
    return NSTerminateNow;
}
@end
int main(int argc, const char **argv) {
    @autoreleasepool {
        NSString *root = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"hud"];
        if (argc > 1 && strcmp(argv[1], "--check-bundle") == 0) {
            BOOL ok = [[NSFileManager defaultManager] isExecutableFileAtPath:[root stringByAppendingPathComponent:@"runtime/node"]] && [[NSFileManager defaultManager] fileExistsAtPath:[root stringByAppendingPathComponent:@"launcher-macos.mjs"]];
            return ok ? 0 : 1;
        }
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        HudDelegate *delegate = [[HudDelegate alloc] init]; app.delegate = delegate; [app run];
    }
    return 0;
}
