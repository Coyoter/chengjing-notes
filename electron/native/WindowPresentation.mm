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
static napi_value injectMissingState(napi_env env, napi_callback_info info) {
  if (!NSApp.active || !(NSApp.keyWindow.styleMask & NSWindowStyleMaskFullScreen)) return json(env, @{ @"injected": @NO });
  NSApp.presentationOptions = NSApplicationPresentationDefault;
  return json(env, @{ @"injected": @YES });
}
#endif
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "read", NAPI_AUTO_LENGTH, readState, nullptr, &fn); napi_set_named_property(env, exports, "read", fn);
  napi_create_function(env, "repair", NAPI_AUTO_LENGTH, repairState, nullptr, &fn); napi_set_named_property(env, exports, "repair", fn);
#ifdef CHENGJING_FULLSCREEN_TEST_FIXTURE
  napi_create_function(env, "injectMissingState", NAPI_AUTO_LENGTH, injectMissingState, nullptr, &fn); napi_set_named_property(env, exports, "injectMissingState", fn);
#endif
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
