// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as path from "path";
import * as fs from "fs";
import { ReactNativeProjectHelper } from "../../common/reactNativeProjectHelper";
import { ErrorHelper } from "../../common/error/errorHelper";
import { ILaunchArgs } from "../../extension/launchArgs";
import { getProjectRoot } from "../nodeDebugWrapper";
import { Telemetry } from "../../common/telemetry";
import { OutputEvent, Logger } from "vscode-debugadapter";
import { TelemetryHelper } from "../../common/telemetryHelper";
import { RemoteTelemetryReporter } from "../../common/telemetryReporters";
import { ChromeDebugAdapter, ChromeDebugSession, IChromeDebugSessionOpts, IAttachRequestArgs, logger } from "vscode-chrome-debug-core";
import { InternalErrorCode } from "../../common/error/internalErrorCode";
import { RemoteExtension } from "../../common/remoteExtension";
import { DebugProtocol } from "vscode-debugprotocol";
import { getLoggingDirectory } from "../../extension/log/LogHelper";
import * as nls from "vscode-nls";
import * as Q from "q";
const localize = nls.loadMessageBundle();

export interface IHermesAttachRequestArgs extends IAttachRequestArgs, ILaunchArgs {
    cwd: string; /* Automatically set by VS Code to the currently opened folder */
}

export interface IHermesLaunchRequestArgs extends DebugProtocol.LaunchRequestArguments, IHermesAttachRequestArgs { }

export class HermesDebugAdapter extends ChromeDebugAdapter {

    private outputLogger: (message: string, error?: boolean | string) => void;
    private projectRootPath: string;
    private remoteExtension: RemoteExtension;
    private isSettingsInitialized: boolean; // used to prevent parameters' reinstallation when attach is called from launch
    private previousAttachArgs: IHermesAttachRequestArgs;

    public constructor(opts: IChromeDebugSessionOpts, debugSession: ChromeDebugSession) {
        super(opts, debugSession);
        this.outputLogger = (message: string, error?: boolean | string) => {
            let category = "console";
            if (error === true) {
                category = "stderr";
            }
            if (typeof error === "string") {
                category = error;
            }

            let newLine = "\n";
            if (category === "stdout" || category === "stderr") {
                newLine = "";
            }
            debugSession.sendEvent(new OutputEvent(message + newLine, category));
        };

        this.isSettingsInitialized = false;
    }

    public launch(launchArgs: IHermesLaunchRequestArgs): Promise<void>  {
        const extProps = {
            platform: {
                value: launchArgs.platform,
                isPii: false,
            },
            isHermes: {
                value: true,
                isPii: false,
            },
        };

        return new Promise<void>((resolve, reject) => this.initializeSettings(launchArgs)
            .then(() => {
                this.outputLogger("Launching the app");
                logger.verbose(`Launching the app: ${JSON.stringify(launchArgs, null , 2)}`);
                return TelemetryHelper.generate("launch", extProps, (generator) => {
                    return this.remoteExtension.launch({ "arguments": launchArgs })
                        .then(() => {
                            return this.remoteExtension.getPackagerPort(launchArgs.cwd);
                        })
                        .then((packagerPort: number) => {
                            launchArgs.port = packagerPort;
                            this.attach(launchArgs).then(() => {
                                resolve();
                            }).catch((e) => reject(e));
                        }).catch((e) => reject(e));
                })
                .catch((err) => {
                    this.outputLogger("An error occurred while launching the application. " + err.message || err, true);
                    this.cleanUp();
                });
        }));
    }

    public attach(attachArgs: IHermesAttachRequestArgs): Promise<void> {
        const extProps = {
            platform: {
                value: attachArgs.platform,
                isPii: false,
            },
            isHermes: {
                value: true,
                isPii: false,
            },
        };

        this.previousAttachArgs = attachArgs;

        return new Promise<void>((resolve, reject) => this.initializeSettings(attachArgs)
            .then(() => {
                this.outputLogger("Attaching to the app");
                logger.verbose(`Attaching to app: ${JSON.stringify(attachArgs, null , 2)}`);
                return TelemetryHelper.generate("attach", extProps, (generator) => {
                    return this.remoteExtension.getPackagerPort(attachArgs.cwd)
                        .then((packagerPort: number) => {
                            this.outputLogger(`Connecting to ${packagerPort} packager port`);
                            const attachArguments = Object.assign({}, attachArgs, {
                                address: "localhost",
                                port: packagerPort,
                                restart: true,
                                request: "attach",
                                remoteRoot: undefined,
                                localRoot: undefined,
                            });
                            super.attach(attachArguments).then(() => {
                                this.outputLogger("The debugger attached successfully");
                                resolve();
                            }).catch((e) => reject(e));
                        }).catch((e) => reject(e));
            })
            .catch((err) => {
                this.outputLogger("An error occurred while attaching to the debugger. " + err.message || err, true);
                this.cleanUp();
            });
        }));
    }

    public disconnect(args: DebugProtocol.DisconnectArguments): void {
        this.cleanUp();
        super.disconnect(args);
    }

    private initializeSettings(args: any): Q.Promise<any> {
        if (!this.isSettingsInitialized) {
            let chromeDebugCoreLogs = getLoggingDirectory();
            if (chromeDebugCoreLogs) {
                chromeDebugCoreLogs = path.join(chromeDebugCoreLogs, "ChromeDebugCoreLogs.txt");
            }
            let logLevel: string = args.trace;
            if (logLevel) {
                logLevel = logLevel.replace(logLevel[0], logLevel[0].toUpperCase());
                logger.setup(Logger.LogLevel[logLevel], chromeDebugCoreLogs || false);
            } else {
                logger.setup(Logger.LogLevel.Log, chromeDebugCoreLogs || false);
            }

            if (!args.sourceMaps) {
                args.sourceMaps = true;
            }

            const projectRootPath = getProjectRoot(args);
            return ReactNativeProjectHelper.isReactNativeProject(projectRootPath)
            .then((result) => {
                if (!result) {
                    throw ErrorHelper.getInternalError(InternalErrorCode.NotInReactNativeFolderError);
                }
                this.projectRootPath = projectRootPath;
                this.remoteExtension = RemoteExtension.atProjectRootPath(this.projectRootPath);
                const version = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf-8")).version;

                // Start to send telemetry
                (this._session as any).getTelemetryReporter().reassignTo(new RemoteTelemetryReporter(
                    "react-native-tools", version, Telemetry.APPINSIGHTS_INSTRUMENTATIONKEY, this.projectRootPath));

                if (args.program) {
                    // TODO: Remove this warning when program property will be completely removed
                    logger.warn(localize("ProgramPropertyDeprecationWarning", "Launched debug configuration contains 'program' property which is deprecated and will be removed soon. Please replace it with: \"cwd\": \"${workspaceFolder}\""));
                    const useProgramEvent = TelemetryHelper.createTelemetryEvent("useProgramProperty");
                    Telemetry.sendHermes(useProgramEvent);
                }
                if (args.cwd) {
                    // To match count of 'cwd' users with 'program' users. TODO: Remove when program property will be removed
                    const useCwdEvent = TelemetryHelper.createTelemetryEvent("useCwdProperty");
                    Telemetry.sendHermes(useCwdEvent);
                }

                this.isSettingsInitialized = true;

                return void 0;
            });
        } else {
            return Q.resolve<void>(void 0);
        }
    }

    private cleanUp() {
        if (this.previousAttachArgs.platform === "android") {
            this.remoteExtension.stopMonitoringLogcat()
                .catch(reason => logger.warn(localize("CouldNotStopMonitoringLogcat", "Couldn't stop monitoring logcat: {0}", reason.message || reason)))
                .finally(() => super.disconnect({terminateDebuggee: true}));
        }
    }

}