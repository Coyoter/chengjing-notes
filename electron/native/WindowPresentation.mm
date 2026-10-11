#import <Cocoa/Cocoa.h>
#include <node_api.h>
#include <cstring>

static napi_value json(napi_env env, NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  napi_value result; napi_create_string_utf8(env, (const char *)data.bytes, data.length, &result); return result;
}
static NSWindow *windowFromHandle(napi_env env, napi_value value) {
  void *buffer = nullptr; size_t length = 0;
  if (napi_get_buffer_info(env, value, &buffer, &length) != napi_ok || length != sizeof(void *)) return nil;
  void *pointer = nullptr; std::memcpy(&pointer, buffer, sizeof(pointer));
  NSObject *object = (__bridge NSObject *)pointer;
  if (!object) return nil;
  if ([object isKindOfClass:NSWindow.class]) return (NSWindow *)object;
  return [object isKindOfClass:NSView.class] ? [(NSView *)object window] : nil;
}
static NSString *preferenceToken() {
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  NSDictionary *global = [defaults persistentDomainForName:NSGlobalDomain];
  NSDictionary *control = [defaults persistentDomainForName:@"com.apple.controlcenter"];
  // Compare opaque preference values rather than guessing their numeric meaning.
  NSArray *values = @[control[@"AutoHideMenuBarOption"] ?: NSNull.null,
    global[@"AppleMenuBarVisibleInFullscreen"] ?: NSNull.null, global[@"_HIHideMenuBar"] ?: NSNull.null];
  NSData *data = [NSJSONSerialization dataWithJSONObject:values options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}
static NSDictionary *snapshot(NSWindow *window) {
  const NSUInteger options = NSApp.presentationOptions;
  return @{ @"fullscreen": @((window.styleMask & NSWindowStyleMaskFullScreen) != 0),
    @"active": @(NSApp.active), @"keyWindow": @(NSApp.keyWindow == window),
    @"minimized": @(window.isMiniaturized), @"menuBarVisible": @(NSMenu.menuBarVisible),
    @"options": @(options), @"autoHideMenuBar": @((options & NSApplicationPresentationAutoHideMenuBar) != 0),
    @"preferenceToken": preferenceToken() };
}
static napi_value readState(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  NSWindow *window = argc == 1 ? windowFromHandle(env, args[0]) : nil;
  if (!window || !NSThread.isMainThread) return json(env, @{ @"available": @NO });
  return json(env, snapshot(window));
}
static napi_value readLayout(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  NSWindow *window = argc == 1 ? windowFromHandle(env, args[0]) : nil;
  if (!window || !NSThread.isMainThread) return json(env, @{ @"available": @NO });
  BOOL fullscreen = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  // CGWindow bounds and Electron bounds use top-left DIP coordinates. AppKit
  // frames use bottom-left coordinates relative to the primary display.
  CGFloat primaryTop = NSMaxY(NSScreen.screens.firstObject.frame);
  NSRect frame = window.frame;
  NSDictionary *bounds = @{ @"x": @(frame.origin.x), @"y": @(primaryTop - NSMaxY(frame)), @"width": @(frame.size.width), @"height": @(frame.size.height) };
  NSMutableArray *bars = [NSMutableArray array];
  if (fullscreen) {
    NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
    const NSInteger menuLevel = CGWindowLevelForKey(kCGMainMenuWindowLevelKey);
    const CGFloat menuHeight = MAX(NSStatusBar.systemStatusBar.thickness, NSMaxY(window.screen.frame) - NSMaxY(window.screen.visibleFrame));
    for (NSDictionary *item in windows) {
      if ([item[(__bridge NSString *)kCGWindowLayer] integerValue] != menuLevel || [item[(__bridge NSString *)kCGWindowAlpha] doubleValue] <= 0) continue;
      CGRect r;
      if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)item[(__bridge NSString *)kCGWindowBounds], &r) || r.size.height > menuHeight + 1) continue;
      [bars addObject:@{ @"x": @(r.origin.x), @"y": @(r.origin.y), @"width": @(r.size.width), @"height": @(r.size.height) }];
    }
  }
  // Only geometry is returned: no window titles, owners, note text or images.
  return json(env, @{ @"available": @YES, @"fullscreen": @(fullscreen), @"windowBounds": bounds, @"menuBars": bars });
}
static napi_value repairState(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  NSWindow *window = argc == 3 ? windowFromHandle(env, args[0]) : nil;
  uint32_t expected = 0; char token[1024]; size_t tokenLength = 0;
  if (!window || !NSThread.isMainThread || napi_get_value_uint32(env, args[1], &expected) != napi_ok
      || napi_get_value_string_utf8(env, args[2], token, sizeof(token), &tokenLength) != napi_ok || tokenLength >= sizeof(token)) {
    return json(env, @{ @"changed": @NO, @"reason": @"unavailable" });
  }
  const NSUInteger safeOptions = NSApplicationPresentationFullScreen | NSApplicationPresentationAutoHideDock | NSApplicationPresentationHideDock
    | NSApplicationPresentationAutoHideMenuBar | NSApplicationPresentationAutoHideToolbar;
  const NSUInteger restricted = NSApplicationPresentationDisableAppleMenu | NSApplicationPresentationDisableProcessSwitching
    | NSApplicationPresentationDisableForceQuit | NSApplicationPresentationDisableSessionTermination | NSApplicationPresentationDisableHideApplication;
  NSDictionary *before = snapshot(window);
  NSString *expectedToken = [[NSString alloc] initWithBytes:token length:tokenLength encoding:NSUTF8StringEncoding];
  NSString *reason = @"healthy";
  if ((expected & ~safeOptions) || !(expected & NSApplicationPresentationFullScreen)
      || !(expected & NSApplicationPresentationAutoHideMenuBar) || !(expected & (NSApplicationPresentationAutoHideDock | NSApplicationPresentationHideDock))) reason = @"invalid-baseline";
  else if (![before[@"fullscreen"] boolValue] || ![before[@"active"] boolValue] || ![before[@"keyWindow"] boolValue]
      || [before[@"minimized"] boolValue]) reason = @"not-active-fullscreen";
  else if (![before[@"preferenceToken"] isEqual:expectedToken]) reason = @"preferences-changed";
  else if (NSApp.presentationOptions & restricted) reason = @"restricted-presentation";
  else if (![before[@"autoHideMenuBar"] boolValue]) {
    @try {
      // Restore this window's last OS-established full-screen presentation only.
      // This never resizes/repositions the window or changes system preferences.
      NSApp.presentationOptions = expected;
      return json(env, @{ @"changed": @YES, @"before": before, @"after": snapshot(window) });
    } @catch (NSException *exception) { reason = @"presentation-unavailable"; }
  }
  return json(env, @{ @"changed": @NO, @"reason": reason, @"state": before });
}
#ifdef CHENGJING_FULLSCREEN_TEST_FIXTURE
static NSPanel *testOverlay;
static napi_value showTestOverlay(napi_env env, napi_callback_info info) {
  NSWindow *window = NSApp.keyWindow;
  if (!window || !(window.styleMask & NSWindowStyleMaskFullScreen)) return json(env, @{ @"shown": @NO });
  NSRect frame = window.screen.frame;
  CGFloat height = NSStatusBar.systemStatusBar.thickness;
  frame.origin.y = NSMaxY(frame) - height; frame.size.height = height;
  testOverlay = [[NSPanel alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  testOverlay.level = CGWindowLevelForKey(kCGMainMenuWindowLevelKey);
  testOverlay.backgroundColor = NSColor.darkGrayColor;
  testOverlay.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  [testOverlay orderFrontRegardless];
  return json(env, @{ @"shown": @YES, @"height": @(height) });
}
static napi_value hideTestOverlay(napi_env env, napi_callback_info info) {
  [testOverlay orderOut:nil]; testOverlay = nil; return json(env, @{ @"hidden": @YES });
}
static napi_value injectMissingState(napi_env env, napi_callback_info info) {
  if (!NSApp.active || !(NSApp.keyWindow.styleMask & NSWindowStyleMaskFullScreen)) return json(env, @{ @"injected": @NO });
  NSApp.presentationOptions = NSApplicationPresentationDefault;
  return json(env, @{ @"injected": @YES });
}
#endif
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "read", NAPI_AUTO_LENGTH, readState, nullptr, &fn); napi_set_named_property(env, exports, "read", fn);
  napi_create_function(env, "readLayout", NAPI_AUTO_LENGTH, readLayout, nullptr, &fn); napi_set_named_property(env, exports, "readLayout", fn);
  napi_create_function(env, "repair", NAPI_AUTO_LENGTH, repairState, nullptr, &fn); napi_set_named_property(env, exports, "repair", fn);
#ifdef CHENGJING_FULLSCREEN_TEST_FIXTURE
  napi_create_function(env, "injectMissingState", NAPI_AUTO_LENGTH, injectMissingState, nullptr, &fn); napi_set_named_property(env, exports, "injectMissingState", fn);
  napi_create_function(env, "showOverlay", NAPI_AUTO_LENGTH, showTestOverlay, nullptr, &fn); napi_set_named_property(env, exports, "showOverlay", fn);
  napi_create_function(env, "hideOverlay", NAPI_AUTO_LENGTH, hideTestOverlay, nullptr, &fn); napi_set_named_property(env, exports, "hideOverlay", fn);
#endif
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
