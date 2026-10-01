#import "AutoSetup.h"
#import <CoreFoundation/CoreFoundation.h>
#include <unistd.h>

static NSString *State(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/CodexComposerHUD"]; }
static NSString *Agent(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/LaunchAgents/io.github.kelvin926.codexcomposerhud.plist"]; }
static void Run(NSString *file, NSArray *args) { NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:file];task.arguments=args;task.standardOutput=[NSFileHandle fileHandleWithNullDevice];task.standardError=[NSFileHandle fileHandleWithNullDevice];if([task launchAndReturnError:NULL])[task waitUntilExit]; }
BOOL HudAutomaticEnabled(void) { return ![[NSFileManager defaultManager] fileExistsAtPath:[State() stringByAppendingPathComponent:@"automatic-disabled"]]; }
BOOL HudConfigureAutomatic(BOOL enabled, NSError **error) {
    NSFileManager *fm=[NSFileManager defaultManager];
    NSString *app=[NSBundle mainBundle].bundlePath,*program=[[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"hud"],*backup=[State() stringByAppendingPathComponent:@"dock-backup.plist"];
    if(![fm createDirectoryAtPath:State() withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:error])return NO;
    NSString *flag=[State() stringByAppendingPathComponent:@"automatic-disabled"];
    if(enabled){
        [fm removeItemAtPath:flag error:NULL];
        if(![fm createDirectoryAtPath:[Agent() stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:error])return NO;
        NSDictionary *plist=@{@"Label":@"io.github.kelvin926.codexcomposerhud",@"ProgramArguments":@[[program stringByAppendingPathComponent:@"runtime/node"],[program stringByAppendingPathComponent:@"launcher-macos.mjs"],@"--watch",@"--quiet"],@"RunAtLoad":@YES,@"ProcessType":@"Background",@"StandardOutPath":[State() stringByAppendingPathComponent:@"agent.log"],@"StandardErrorPath":[State() stringByAppendingPathComponent:@"agent.log"]};
        NSData *data=[NSPropertyListSerialization dataWithPropertyList:plist format:NSPropertyListXMLFormat_v1_0 options:0 error:error];
        if(![data writeToFile:Agent() options:NSDataWritingAtomic error:error])return NO;
    }else{
        Run(@"/bin/launchctl",@[@"bootout",[NSString stringWithFormat:@"gui/%u",getuid()],Agent()]);
        [fm removeItemAtPath:Agent() error:NULL];[@"disabled\n" writeToFile:flag atomically:YES encoding:NSUTF8StringEncoding error:error];
    }
    NSArray *saved=[NSArray arrayWithContentsOfFile:backup]?:@[];
    NSMutableArray *records=[saved mutableCopy];
    CFPropertyListRef pref=CFPreferencesCopyAppValue(CFSTR("persistent-apps"),CFSTR("com.apple.dock"));
    NSArray *originalTiles=CFBridgingRelease(pref);
    NSMutableArray *tiles=[([originalTiles isKindOfClass:[NSArray class]]?originalTiles:@[]) mutableCopy];
    NSString *replacement=[NSURL fileURLWithPath:app].absoluteString;
    BOOL changed=NO;
    for(NSUInteger i=0;i<tiles.count;i++){
        NSDictionary *tile=tiles[i];if(![tile isKindOfClass:[NSDictionary class]])continue;NSString *url=tile[@"tile-data"][@"file-data"][@"_CFURLString"];
        if(![url isKindOfClass:[NSString class]])continue;
        if(enabled){
            NSURL *source=[NSURL URLWithString:url];NSString *file=source.path;
            if(![@[@"Codex.app",@"ChatGPT.app"] containsObject:file.lastPathComponent]||![fm fileExistsAtPath:[file stringByAppendingPathComponent:@"Contents/Resources/app.asar"]])continue;
            NSMutableDictionary *updated=[tile mutableCopy],*details=[tile[@"tile-data"] mutableCopy],*fileData=[details[@"file-data"] mutableCopy];
            [records addObject:@{@"original":tile,@"replacement":replacement}];
            fileData[@"_CFURLString"]=replacement;fileData[@"_CFURLStringType"]=@15;details[@"file-data"]=fileData;
            [details removeObjectForKey:@"book"];[details removeObjectForKey:@"file-bookmark"];
            details[@"bundle-identifier"]=@"io.github.kelvin926.codexcomposerhud";updated[@"tile-data"]=details;tiles[i]=updated;changed=YES;
        }else{
            for(NSDictionary *record in saved)if([url isEqualToString:record[@"replacement"]]){tiles[i]=record[@"original"];changed=YES;break;}
        }
    }
    if(enabled&&![(NSArray *)records writeToFile:backup atomically:YES])return NO;
    if(changed){CFPreferencesSetAppValue(CFSTR("persistent-apps"),(__bridge CFPropertyListRef)tiles,CFSTR("com.apple.dock"));CFPreferencesAppSynchronize(CFSTR("com.apple.dock"));Run(@"/usr/bin/killall",@[@"Dock"]);}
    if(enabled)Run(@"/bin/launchctl",@[@"bootstrap",[NSString stringWithFormat:@"gui/%u",getuid()],Agent()]);
    return YES;
}
