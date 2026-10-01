#import <Cocoa/Cocoa.h>
#include <string.h>
#import "AutoSetup.h"

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
    NSMenuItem *disable=[items addItemWithTitle:@"자동 연결 끄기" action:@selector(disableAutomatic:) keyEquivalent:@""];disable.target=self;
    application.submenu = items; [menu addItem:application]; NSApp.mainMenu = menu;
    if(HudAutomaticEnabled())HudConfigureAutomatic(YES,NULL);
    self.worker = [self taskWithArguments:@[]];
    NSError *error = nil;
    if (![self.worker launchAndReturnError:&error]) {
        NSAlert *alert = [[NSAlert alloc] init]; alert.messageText = @"표시기를 실행할 수 없습니다.";
        alert.informativeText = error.localizedDescription; [alert runModal]; [NSApp terminate:nil];
    }
}
- (void)disableAutomatic:(id)sender { HudConfigureAutomatic(NO,NULL); [NSApp terminate:nil]; }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)application hasVisibleWindows:(BOOL)visible {
    [[self taskWithArguments:@[]] launchAndReturnError:NULL]; return NO;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    NSMutableArray *args=[NSMutableArray arrayWithObject:@"--app-args"];for(NSURL *url in urls)[args addObject:url.absoluteString];[[self taskWithArguments:args] launchAndReturnError:NULL];
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
        if(argc>1&&(strcmp(argv[1],"--install-auto")==0||strcmp(argv[1],"--remove-auto")==0))return HudConfigureAutomatic(strcmp(argv[1],"--install-auto")==0,NULL)?0:1;
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
