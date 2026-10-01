#import "AutoSetup.h"
#import <CoreFoundation/CoreFoundation.h>
#include <unistd.h>

static NSString *State(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/CodexComposerHUD"]; }
static NSString *Agent(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/LaunchAgents/io.github.kelvin926.codexcomposerhud.plist"]; }
static BOOL Run(NSString *file, NSArray *args) { NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:file];task.arguments=args;task.standardOutput=[NSFileHandle fileHandleWithNullDevice];task.standardError=[NSFileHandle fileHandleWithNullDevice];if(![task launchAndReturnError:NULL])return NO;[task waitUntilExit];return task.terminationStatus==0; }
NSString *HudCreateLaunchProxy(NSString *source, NSError **error) {
    NSFileManager *fm=[NSFileManager defaultManager];
    if(![@[@"Codex.app",@"ChatGPT.app"] containsObject:source.lastPathComponent])return nil;
    NSBundle *vendor=[NSBundle bundleWithPath:source];NSDictionary *info=vendor.infoDictionary;
    NSString *icon=info[@"CFBundleIconFile"],*iconName=info[@"CFBundleIconName"],*asset=nil;
    if(icon.length){if(!icon.pathExtension.length)icon=[icon stringByAppendingPathExtension:@"icns"];asset=[vendor.resourcePath stringByAppendingPathComponent:icon];if(![fm fileExistsAtPath:asset])asset=nil;}
    if(!asset&&iconName.length){asset=[vendor.resourcePath stringByAppendingPathComponent:@"Assets.car"];if(![fm fileExistsAtPath:asset])asset=nil;}
    // Leave the vendor tile alone if its original icon cannot be preserved.
    if(!asset)return nil;
    NSString *proxy=[[State() stringByAppendingPathComponent:@"launch-proxies"] stringByAppendingPathComponent:source.lastPathComponent];
    NSString *contents=[proxy stringByAppendingPathComponent:@"Contents"],*plist=[contents stringByAppendingPathComponent:@"Info.plist"],*resources=[contents stringByAppendingPathComponent:@"Resources"],*macos=[contents stringByAppendingPathComponent:@"MacOS"];
    NSDictionary *previous=[NSDictionary dictionaryWithContentsOfFile:plist];
    if([fm fileExistsAtPath:proxy]&&![previous[@"HUDLaunchProxy"] boolValue])return nil;
    if(![fm createDirectoryAtPath:resources withIntermediateDirectories:YES attributes:nil error:error]||![fm createDirectoryAtPath:macos withIntermediateDirectories:YES attributes:nil error:error])return nil;
    NSString *destination=[resources stringByAppendingPathComponent:asset.lastPathComponent];
    NSData *image=[NSData dataWithContentsOfFile:asset];if(![image writeToFile:destination options:NSDataWritingAtomic error:error])return nil;
    NSString *program=[[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"hud"];
    NSString *executable=[macos stringByAppendingPathComponent:@"launch"];
    NSData *binary=[NSData dataWithContentsOfFile:[NSBundle mainBundle].executablePath];
    if(![binary writeToFile:executable options:NSDataWritingAtomic error:error]||![fm setAttributes:@{NSFilePosixPermissions:@0755} ofItemAtPath:executable error:error])return nil;
    NSString *identifier=[@"io.github.kelvin926.codexcomposerhud.launch." stringByAppendingString:source.lastPathComponent.stringByDeletingPathExtension.lowercaseString];
    NSMutableDictionary *proxyInfo=[@{@"CFBundleIdentifier":identifier,@"CFBundleExecutable":@"launch",@"CFBundlePackageType":@"APPL",@"CFBundleName":info[@"CFBundleName"]?:source.lastPathComponent.stringByDeletingPathExtension,@"CFBundleVersion":[[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleVersion"]?:@"1",@"LSUIElement":@YES,@"HUDLaunchProxy":@YES,@"HUDProgramRoot":program} mutableCopy];
    if([asset.lastPathComponent isEqualToString:@"Assets.car"])proxyInfo[@"CFBundleIconName"]=iconName;else proxyInfo[@"CFBundleIconFile"]=asset.lastPathComponent;
    if(![proxyInfo writeToFile:plist atomically:YES]||!Run(@"/usr/bin/codesign",@[@"--force",@"--sign",@"-",proxy]))return nil;
    return [NSURL fileURLWithPath:proxy].absoluteString;
}
BOOL HudAutomaticEnabled(void) { return ![[NSFileManager defaultManager] fileExistsAtPath:[State() stringByAppendingPathComponent:@"automatic-disabled"]]; }
BOOL HudConfigureAutomatic(BOOL enabled, NSError **error) {
    NSFileManager *fm=[NSFileManager defaultManager];
    NSString *program=[[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"hud"],*backup=[State() stringByAppendingPathComponent:@"dock-backup.plist"];
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
    NSMutableArray *records=[NSMutableArray new];
    CFPropertyListRef pref=CFPreferencesCopyAppValue(CFSTR("persistent-apps"),CFSTR("com.apple.dock"));
    NSArray *originalTiles=CFBridgingRelease(pref);
    NSMutableArray *tiles=[([originalTiles isKindOfClass:[NSArray class]]?originalTiles:@[]) mutableCopy];
    BOOL changed=NO;
    for(NSUInteger i=0;i<tiles.count;i++){
        NSDictionary *tile=tiles[i];if(![tile isKindOfClass:[NSDictionary class]])continue;NSString *url=tile[@"tile-data"][@"file-data"][@"_CFURLString"];
        if(![url isKindOfClass:[NSString class]])continue;
        NSDictionary *original=tile;
        for(NSDictionary *record in saved){
            NSDictionary *candidate=record[@"original"];
            if([url isEqualToString:record[@"replacement"]]&&[tile[@"GUID"] isEqual:candidate[@"GUID"]]){original=candidate;break;}
        }
        if(enabled){
            NSURL *source=[NSURL URLWithString:original[@"tile-data"][@"file-data"][@"_CFURLString"]];NSString *file=source.path;
            if(![@[@"Codex.app",@"ChatGPT.app"] containsObject:file.lastPathComponent]||![fm fileExistsAtPath:[file stringByAppendingPathComponent:@"Contents/Resources/app.asar"]])continue;
            NSString *replacement=HudCreateLaunchProxy(file,error);
            if(!replacement){if(original!=tile){tiles[i]=original;changed=YES;}continue;}
            NSMutableDictionary *updated=[original mutableCopy],*details=[original[@"tile-data"] mutableCopy],*fileData=[details[@"file-data"] mutableCopy];
            [records addObject:@{@"original":original,@"replacement":replacement}];
            fileData[@"_CFURLString"]=replacement;fileData[@"_CFURLStringType"]=@15;details[@"file-data"]=fileData;
            [details removeObjectForKey:@"book"];[details removeObjectForKey:@"file-bookmark"];
            details[@"bundle-identifier"]=[NSDictionary dictionaryWithContentsOfFile:[[NSURL URLWithString:replacement].path stringByAppendingPathComponent:@"Contents/Info.plist"]][@"CFBundleIdentifier"];updated[@"tile-data"]=details;
            if(![tile isEqual:updated]){tiles[i]=updated;changed=YES;}
        }else{
            if(original!=tile){tiles[i]=original;changed=YES;}
        }
    }
    if(enabled&&![(NSArray *)records writeToFile:backup atomically:YES])return NO;
    if(changed){CFPreferencesSetAppValue(CFSTR("persistent-apps"),(__bridge CFPropertyListRef)tiles,CFSTR("com.apple.dock"));CFPreferencesAppSynchronize(CFSTR("com.apple.dock"));Run(@"/usr/bin/killall",@[@"Dock"]);}
    if(enabled)Run(@"/bin/launchctl",@[@"bootstrap",[NSString stringWithFormat:@"gui/%u",getuid()],Agent()]);
    return YES;
}
