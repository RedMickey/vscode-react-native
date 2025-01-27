// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as Q from "q";
import * as path from "path";
import * as semver from "semver";

import {ChildProcess} from "../../common/node/childProcess";
import {CommandExecutor} from "../../common/commandExecutor";
import {GeneralMobilePlatform, MobilePlatformDeps, TargetType} from "../generalMobilePlatform";
import {IIOSRunOptions} from "../launchArgs";
import {PlistBuddy} from "./plistBuddy";
import {IOSDebugModeManager} from "./iOSDebugModeManager";
import {OutputVerifier, PatternToFailure} from "../../common/outputVerifier";
import {SettingsHelper} from "../settingsHelper";
import {RemoteExtension} from "../../common/remoteExtension";
import {ReactNativeProjectHelper} from "../../common/reactNativeProjectHelper";
import {TelemetryHelper} from "../../common/telemetryHelper";
import { InternalErrorCode } from "../../common/error/internalErrorCode";
import * as nls from "vscode-nls";
const localize = nls.loadMessageBundle();

export class IOSPlatform extends GeneralMobilePlatform {
    public static DEFAULT_IOS_PROJECT_RELATIVE_PATH = "ios";
    private static remoteExtension: RemoteExtension;

    private plistBuddy = new PlistBuddy();
    private targetType: TargetType = "simulator";
    private iosProjectRoot: string;
    private iosDebugModeManager: IOSDebugModeManager;

    private defaultConfiguration: string = "Debug";
    private configurationArgumentName: string = "--configuration";

    // We should add the common iOS build/run errors we find to this list
    private static RUN_IOS_FAILURE_PATTERNS: PatternToFailure[] = [{
        pattern: "No devices are booted",
        errorCode: InternalErrorCode.IOSSimulatorNotLaunchable,
    }, {
        pattern: "FBSOpenApplicationErrorDomain",
        errorCode: InternalErrorCode.IOSSimulatorNotLaunchable,
    }, {
        pattern: "ios-deploy",
        errorCode: InternalErrorCode.IOSDeployNotFound,
    }];

    private static readonly RUN_IOS_SUCCESS_PATTERNS = ["BUILD SUCCEEDED"];

    public showDevMenu(deviceId?: string): Q.Promise<void> {
        return IOSPlatform.remote(this.runOptions.projectRoot).showDevMenu(deviceId);
    }

    public reloadApp(deviceId?: string): Q.Promise<void> {
        return IOSPlatform.remote(this.runOptions.projectRoot).reloadApp(deviceId);
    }

    constructor(protected runOptions: IIOSRunOptions, platformDeps: MobilePlatformDeps = {}) {
        super(runOptions, platformDeps);

        this.runOptions.configuration = this.getConfiguration();

        if (this.runOptions.iosRelativeProjectPath) { // Deprecated option
            this.logger.warning(localize("iosRelativeProjectPathOptionIsDeprecatedUseRunArgumentsInstead", "'iosRelativeProjectPath' option is deprecated. Please use 'runArguments' instead."));
        }

        this.iosProjectRoot = path.join(this.projectPath, this.runOptions.iosRelativeProjectPath || IOSPlatform.DEFAULT_IOS_PROJECT_RELATIVE_PATH);
        const schemeFromArgs = IOSPlatform.getOptFromRunArgs(this.runArguments, "--scheme", false);
        this.iosDebugModeManager  = new IOSDebugModeManager(this.iosProjectRoot, schemeFromArgs ? schemeFromArgs : this.runOptions.scheme);

        if (this.runArguments && this.runArguments.length > 0) {
            this.targetType = (this.runArguments.indexOf(`--${IOSPlatform.deviceString}`) >= 0) ?
                IOSPlatform.deviceString : IOSPlatform.simulatorString;
            return;
        }

        if (this.runOptions.target && (this.runOptions.target !== IOSPlatform.simulatorString &&
                this.runOptions.target !== IOSPlatform.deviceString)) {

            this.targetType = IOSPlatform.simulatorString;
            return;
        }

        this.targetType = this.runOptions.target || IOSPlatform.simulatorString;
    }

    public runApp(): Q.Promise<void> {
        const extProps = {
            platform: {
                value: "ios",
                isPii: false,
            },
        };

        return TelemetryHelper.generate("iOSPlatform.runApp", extProps, () => {
            // Compile, deploy, and launch the app on either a simulator or a device
            const env = this.getEnvArgument();

            return ReactNativeProjectHelper.getReactNativeVersion(this.runOptions.projectRoot)
                .then(version => {
                    if (!semver.valid(version) /*Custom RN implementations should support this flag*/ || semver.gte(version, IOSPlatform.NO_PACKAGER_VERSION)) {
                        this.runArguments.push("--no-packager");
                    }
                    // Since @react-native-community/cli@2.1.0 build output are hidden by default
                    // we are using `--verbose` to show it as it contains `BUILD SUCCESSFUL` and other patterns
                    if (semver.gte(version, "0.60.0")) {
                        this.runArguments.push("--verbose");
                    }
                    const runIosSpawn = new CommandExecutor(this.projectPath, this.logger).spawnReactCommand("run-ios", this.runArguments, {env});
                    return new OutputVerifier(() => this.generateSuccessPatterns(version), () => Q(IOSPlatform.RUN_IOS_FAILURE_PATTERNS), "ios")
                        .process(runIosSpawn);
                });
        });
    }

    public enableJSDebuggingMode(): Q.Promise<void> {
        // Configure the app for debugging
        if (this.targetType === IOSPlatform.deviceString) {
            // Note that currently we cannot automatically switch the device into debug mode.
            this.logger.info("Application is running on a device, please shake device and select 'Debug JS Remotely' to enable debugging.");
            return Q.resolve<void>(void 0);
        }

        // Wait until the configuration file exists, and check to see if debugging is enabled
        return Q.all<boolean | string>([
            this.iosDebugModeManager.getSimulatorRemoteDebuggingSetting(this.runOptions.configuration, this.runOptions.productName),
            this.getBundleId(),
        ])
            .spread((debugModeEnabled: boolean, bundleId: string) => {
                if (debugModeEnabled) {
                    return Q.resolve(void 0);
                }

                // Debugging must still be enabled
                // We enable debugging by writing to a plist file that backs a NSUserDefaults object,
                // but that file is written to by the app on occasion. To avoid races, we shut the app
                // down before writing to the file.
                const childProcess = new ChildProcess();

                return childProcess.execToString("xcrun simctl spawn booted launchctl list")
                    .then((output: string) => {
                        // Try to find an entry that looks like UIKitApplication:com.example.myApp[0x4f37]
                        const regex = new RegExp(`(\\S+${bundleId}\\S+)`);
                        const match = regex.exec(output);

                        // If we don't find a match, the app must not be running and so we do not need to close it
                        return match ? childProcess.exec(`xcrun simctl spawn booted launchctl stop ${match[1]}`) : null;
                    })
                    .then(() => {
                        // Write to the settings file while the app is not running to avoid races
                        return this.iosDebugModeManager.setSimulatorRemoteDebuggingSetting(/*enable=*/ true, this.runOptions.configuration, this.runOptions.productName);
                    })
                    .then(() => {
                        // Relaunch the app
                        return this.runApp();
                    });
            });
    }

    public disableJSDebuggingMode(): Q.Promise<void> {
        return this.iosDebugModeManager.setSimulatorRemoteDebuggingSetting(/*enable=*/ false, this.runOptions.configuration, this.runOptions.productName);
    }

    public prewarmBundleCache(): Q.Promise<void> {
        return this.packager.prewarmBundleCache("ios");
    }

    public getRunArguments(): string[] {
        let runArguments: string[] = [];

        if (this.runOptions.runArguments && this.runOptions.runArguments.length > 0) {
            runArguments = this.runOptions.runArguments;
            if (this.runOptions.scheme) {
                const schemeFromArgs = IOSPlatform.getOptFromRunArgs(runArguments, "--scheme", false);
                if (!schemeFromArgs) {
                    runArguments.push("--scheme", this.runOptions.scheme);
                } else {
                    this.logger.warning(localize("iosSchemeParameterAlreadySetInRunArguments", "'--scheme' is set as 'runArguments' configuration parameter value, 'scheme' configuration parameter value will be omitted"));
                }
            }
        } else {
            if (this.runOptions.target) {
                if (this.runOptions.target === IOSPlatform.deviceString ||
                    this.runOptions.target === IOSPlatform.simulatorString) {

                    runArguments.push(`--${this.runOptions.target}`);
                } else {
                    runArguments.push("--simulator", `${this.runOptions.target}`);
                }
            }

            if (this.runOptions.iosRelativeProjectPath) {
                runArguments.push("--project-path", this.runOptions.iosRelativeProjectPath);
            }

            // provide any defined scheme
            if (this.runOptions.scheme) {
                runArguments.push("--scheme", this.runOptions.scheme);
            }
        }

        return runArguments;
    }

    private generateSuccessPatterns(version: string): Q.Promise<string[]> {
        // Clone RUN_IOS_SUCCESS_PATTERNS to avoid its runtime mutation
        let successPatterns = [...IOSPlatform.RUN_IOS_SUCCESS_PATTERNS];
        if (this.targetType === IOSPlatform.deviceString) {
            if (semver.gte(version, "0.60.0")) {
                successPatterns.push("success Installed the app on the device");
            } else {
                successPatterns.push("INSTALLATION SUCCEEDED");
            }
            return Q(successPatterns);
        } else {
            return this.getBundleId()
            .then(bundleId => {
                if (semver.gte(version, "0.60.0")) {
                    successPatterns.push(`Launching "${bundleId}"\nsuccess Successfully launched the app `);
                } else {
                    successPatterns.push(`Launching ${bundleId}\n${bundleId}: `);
                }
                return successPatterns;
            });
        }

    }

    private getConfiguration(): string {
        return IOSPlatform.getOptFromRunArgs(this.runArguments, this.configurationArgumentName) || this.defaultConfiguration;
    }

    private getBundleId(): Q.Promise<string> {
        let scheme = this.runOptions.scheme;
        if (!scheme) {
            const schemeFromArgs = IOSPlatform.getOptFromRunArgs(this.runArguments, "--scheme", false);
            if (schemeFromArgs) {
                scheme = schemeFromArgs;
            }
        }
        return this.plistBuddy.getBundleId(this.iosProjectRoot, true, this.runOptions.configuration, this.runOptions.productName, scheme);
    }

    private static remote(fsPath: string): RemoteExtension {
        if (this.remoteExtension) {
            return this.remoteExtension;
        } else {
            return this.remoteExtension = RemoteExtension.atProjectRootPath(SettingsHelper.getReactNativeProjectRoot(fsPath));
        }
    }
}
