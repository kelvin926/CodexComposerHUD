#import <Foundation/Foundation.h>
BOOL HudAutomaticEnabled(void);
BOOL HudConfigureAutomatic(BOOL enabled, NSError **error);
NSString *HudCreateLaunchProxy(NSString *source, NSError **error);
