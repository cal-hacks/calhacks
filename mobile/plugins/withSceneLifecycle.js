// iOS 27 won't launch an app built with its SDK unless it adopts the scene
// lifecycle (UIScene). Expo 54's generated AppDelegate creates its window and
// starts React Native in application(_:didFinishLaunchingWithOptions:), and
// expo-dev-launcher needs that window to exist right then, so the startup is
// left as it is. This plugin:
//   1. declares a scene configuration in Info.plist,
//   2. adds SceneDelegate.swift, which moves AppDelegate's window into the
//      scene when it connects,
//   3. forwards links that arrive through the scene to AppDelegate, so deep
//      links and the dev client's project URL keep working.
const { IOSConfig, withDangerousMod, withInfoPlist, withXcodeProject } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SCENE_DELEGATE = `import Expo
import React
import UIKit

// Created by plugins/withSceneLifecycle.js.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let window = app.window else { return }
    // AppDelegate already made the window and started React Native in it.
    window.windowScene = windowScene
    window.frame = windowScene.coordinateSpace.bounds
    self.window = window
    window.makeKeyAndVisible()

    // A link that launched the app (deep links, the dev client's project URL).
    if let url = connectionOptions.urlContexts.first?.url {
      _ = app.application(UIApplication.shared, open: url, options: [:])
    }
    if let activity = connectionOptions.userActivities.first {
      _ = app.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = app.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = app.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneDelegateFile(config) {
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const name = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      fs.writeFileSync(path.join(cfg.modRequest.platformProjectRoot, name, "SceneDelegate.swift"), SCENE_DELEGATE);
      return cfg;
    },
  ]);
  return withXcodeProject(config, (cfg) => {
    const name = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const filepath = `${name}/SceneDelegate.swift`;
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project: cfg.modResults });
    }
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneDelegateFile(withSceneManifest(config));
};
