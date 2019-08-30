# Telemetry description

## Node Debugger telemetry and Direct Debugger telemetry comparison

  |Node Debugger telemetry events|Direct Debugger telemetry events|
  |---|---|
  | - useProgramProperty| - removed|
  | - useCwdProperty| - removed|
  |Consists of 5 steps: initialStep, startPackager, prewarmBundleCache, mobilePlatform.runApp, mobilePlatform.enableJSDebuggingMode. Each step is independent telemetry object that measures its completion time (in form <eventname>.time) and may contain additional properties such as errors etc.| - launch<br> We added the special new launch event to separate the launch of Direct debugger from default app launch. All default launch steps remained. <br>added property `isDirect`<br><img src="./images/Screen Shot 2019-08-30 at 11.43.06.png" alt="drawing"/>|
  | - attach<br>default ChromeDebugAdapter event<br><img src="./images/Screen Shot 2019-08-30 at 11.46.53.png" alt="drawing"/>|  - attach<br>added property `isDirect`<br><img src="./images/Screen Shot 2019-08-30 at 11.43.18.png" alt="drawing"/>|

## Telemetry launch extension error events

 - ActivateCouldNotFindWorkspace
   <br>Emits if a user tries to start the debugger without opening React Native project folder or workspace. This event contains error code number 802 - `CouldNotFindWorkspace`.
   <br><img src="./images/Screen Shot 2019-08-30 at 11.58.59.png" alt="drawing"/>

 - AddProjectReactNativeVersionIsEmpty
   <br>Emits if a user opened a folder which doesn't contain React Native project or React Native project version and tries to start the debugger. This event contains error code number 605 - `CouldNotFindProjectVersion`.
   <br><img src="./images/Screen Shot 2019-08-30 at 12.07.25.png" alt="drawing"/>
