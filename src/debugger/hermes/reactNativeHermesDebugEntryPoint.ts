// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as os from 'os';
import * as fs from "fs";
import * as path from "path";
import { TelemetryHelper } from "../../common/telemetryHelper";
import { EntryPointHandler, ProcessType } from "../../common/entryPointHandler";
import { ErrorHelper } from "../../common/error/errorHelper";
import { InternalErrorCode } from "../../common/error/internalErrorCode";
import { NullTelemetryReporter, ReassignableTelemetryReporter } from "../../common/telemetryReporters";
import { HermesDebugAdapter } from "./hermesDebugAdapter";
import { ChromeDebugSession, BaseSourceMapTransformer, BasePathTransformer } from "vscode-chrome-debug-core";
import { DebugSession, OutputEvent, TerminatedEvent } from "vscode-debugadapter";
import * as nls from "vscode-nls";
const localize = nls.loadMessageBundle();

const projectRoot = path.join(__dirname, "..", "..", "..");
const version = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")).version;
const extensionName = "react-native-tools";
const telemetryReporter = new ReassignableTelemetryReporter(new NullTelemetryReporter());

function bailOut(reason: string): void {
    // Things have gone wrong in initialization: Report the error to telemetry and exit
    TelemetryHelper.sendSimpleEvent(reason);
    process.exit(1);
}

function codeToRun() {
    try {
        try {
            ChromeDebugSession.run(ChromeDebugSession.getSession({
                adapter: HermesDebugAdapter,
                extensionName: extensionName,
                pathTransformer: BasePathTransformer,
                sourceMapTransformer: BaseSourceMapTransformer,
                logFilePath: path.resolve(os.tmpdir(), 'vscode-chrome-debug.txt'),
            }));
        } catch (e) {
            const debugSession = new DebugSession();
            // Start session before sending any events otherwise the client wouldn't receive them
            debugSession.start(process.stdin, process.stdout);
            debugSession.sendEvent(new OutputEvent(localize("UnableToStartDebugAdapter", "Unable to start debug adapter: {0}", e.toString()), "stderr"));
            debugSession.sendEvent(new TerminatedEvent());
            bailOut(e.toString());
        }
    } catch (e) {
        // Nothing we can do here: can't even communicate back because we don't know how to speak debug adapter
        bailOut("cannotFindDebugAdapter");
    }

}

// Enable telemetry
const entryPointHandler = new EntryPointHandler(ProcessType.Debugger);
entryPointHandler.runApp(
    extensionName,
    version,
    ErrorHelper.getInternalError(InternalErrorCode.DebuggingFailed),
    telemetryReporter,
    codeToRun
);

