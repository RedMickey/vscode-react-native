# Telemetry description

## Node Debugger telemetry and Direct Debugger telemetry comparison

  |Node Debugger telemetry events|Direct Debugger telemetry events|
  |---|---|
  | - useProgramProperty| - removed|
  | - useCwdProperty| - removed|
  |Consists of 5 steps: initialStep, startPackager, prewarmBundleCache, mobilePlatform.runApp, mobilePlatform.enableJSDebuggingMode. Each step is independent telemetry object that measures its completion time (in form <eventname>.time) and may contain additional properties such as errors etc.| - launch<br> We added the special new launch event to separate the launch of Direct debugger from default app launch. All default telemetry steps are similar to Node Debugger case and all parameters remained the same. <br>added property `isDirect`<br><img src="./images/ScreenShot2019-08-30at11.43.06.png" alt="drawing"/>|
  | - attach<br>default ChromeDebugAdapter event<br><img src="./images/ScreenShot2019-08-30at11.46.53.png" alt="drawing"/>|  - attach<br>added property `isDirect`<br><img src="./images/ScreenShot2019-08-30at11.43.18.png" alt="drawing"/>|
  | - launch.initialStep<br><img src="./images/ScreenShot2019-09-09at09.35.14.png" alt="drawing"/>|  - launch.initialStep<br>added property `isDirect`<br><img src="./images/ScreenShot2019-09-09at09.20.03.png" alt="drawing"/>|
  | - launch.checkPlatformCompatibility<br><img src="./images/ScreenShot2019-09-09at09.36.12.png" alt="drawing"/>|  - launch.checkPlatformCompatibility<br>added property `isDirect`<br><img src="./images/ScreenShot2019-09-09at09.21.49.png" alt="drawing"/>|
  | - launch.startPackager<br><img src="./images/ScreenShot2019-09-09at09.37.29.png" alt="drawing"/>|  - launch.startPackager<br>added property `isDirect`<br><img src="./images/ScreenShot2019-09-09at09.24.41.png" alt="drawing"/>|
  | - launch.prewarmBundleCache<br><img src="./images/ScreenShot2019-09-09at09.40.29.png" alt="drawing"/>|  - launch.prewarmBundleCache<br>added property `isDirect`<br><img src="./images/ScreenShot2019-09-09at09.26.02.png" alt="drawing"/>|
  | - AndroidPlatform.runApp<br><img src="./images/ScreenShot2019-09-09at09.41.11.png" alt="drawing"/>|  - AndroidPlatform.runApp<br>added property `isDirect`<br><img src="./images/ScreenShot2019-09-09at09.27.30.png" alt="drawing"/>|
  | - launch.mobilePlatform.runApp<br><img src="./images/ScreenShot2019-09-09at09.41.55.png" alt="drawing"/>|  - launch.mobilePlatform.runApp<br>added property `isDirect`<br><img src="./images/ScreenShot2019-09-09at09.28.32.png" alt="drawing"/>|
  | - mobilePlatform.enableJSDebuggingMode<br>the step for NodeDebugAdapter in `launch` app telemetry sequence<br><img src="./images/ScreenShot2019-09-02at13.52.47.png" alt="drawing"/>|  - mobilePlatform.enableDirectDebuggingMode<br>added the step `mobilePlatform.enableDirectDebuggingMode` in `launch` app telemetry sequence instead of `mobilePlatform.enableJSDebuggingMode`<br><img src="./images/ScreenShot2019-09-02at13.54.52.png" alt="drawing"/>|

## Telemetry launch extension error events

 - ActivateCouldNotFindWorkspace
   <br>Emits if a user tries to start the debugger without opening React Native project folder or workspace. This event contains error code number 802 - `CouldNotFindWorkspace`.
   <br><img src="./images/ScreenShot2019-08-30at11.58.59.png" alt="drawing"/>

 - AddProjectReactNativeVersionIsEmpty
   <br>Emits if a user opened a folder which doesn't contain React Native project or React Native project version and tries to start the debugger. This event contains error code number 605 - `CouldNotFindProjectVersion`.
   <br><img src="./images/ScreenShot2019-08-30at12.07.25.png" alt="drawing"/>
