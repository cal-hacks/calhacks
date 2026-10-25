// Xcode 27 refuses pod targets that declare a deployment target below iOS 15
// (Google Sign-In, SDWebImage and friends still say 9–13). Raise them in the
// generated Podfile's post_install so `expo prebuild` keeps the fix.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MIN_IOS = "15.1";
const MARKER = "# orbit: minimum iOS for pods";

module.exports = function withPodsMinimumIos(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let text = fs.readFileSync(podfile, "utf8");
      if (!text.includes(MARKER)) {
        text = text.replace(
          /post_install do \|installer\|\n/,
          (m) =>
            m +
            `    ${MARKER}\n` +
            "    installer.pods_project.targets.each do |t|\n" +
            "      t.build_configurations.each do |c|\n" +
            `        if c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${MIN_IOS}\n` +
            `          c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'\n` +
            "        end\n" +
            "      end\n" +
            "    end\n",
        );
        fs.writeFileSync(podfile, text);
      }
      return cfg;
    },
  ]);
};
