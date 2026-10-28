# printToFileAsync and printAsync hang on Android when a GC runs during the render

This is a blank Expo app (`npx create-expo-app@latest --template blank`) with `expo-print` 58.0.7 added. Each button runs 200 calls in a row, one call at a time, on a plain HTML table. The app counts each call as settled, rejected, or never settled. A call that hasn't answered after 20 seconds counts as never settled.

- "Run 200 printToFileAsync calls" calls `Print.printToFileAsync({ html })`.
- "Run 200 printAsync calls" calls `Print.printAsync({ html })`. Each call opens the system print dialog, and the next call starts after the dialog closes.
- "Run 200 nativePrint calls" calls `requireNativeModule('ExpoPrint').print({ html })`. This skips the `isPrinting` guard in `printAsync`, so every call counts on its own.

On Android, a Java garbage collection during a render can make a call fail:

- `printToFileAsync` never settles, or rejects with `An error occurred while writing the PDF data`.
- `printAsync` never settles, and the print dialog never opens. After that, the `isPrinting` guard rejects every later `printAsync` call with `Another print request is already in progress` until the app restarts.

## Run it

```sh
npm install
npx expo run:android
```

`expo run:android` makes a debug build. `force-gc.sh` needs a debug build because it uses `run-as`.

In a second terminal, run `./force-gc.sh`. It sends `SIGUSR1` to the app about 10 times a second, and ART answers each signal with a forced GC. Logcat shows `SIGUSR1 forcing GC (no HPROF) and profile save` for each one. Press Ctrl+C to stop it.

For the `printAsync` and `nativePrint` buttons, also run `./dismiss-print-dialog.sh` in a third terminal. It presses Back whenever the print dialog has focus, so the run continues without anyone closing the dialog. It never presses Back while the app has focus.

Tap a button. All 200 calls should settle. Instead, some never settle and some reject.

## Results

`printToFileAsync` on a Pixel 9 Pro XL emulator, Android API 37, expo-print 58.0.7:

| Run | Forced GCs | Settled | Never settled | Rejected |
|---|---|---|---|---|
| With `force-gc.sh` | 409 | 161 | 4 | 35 |
| Without `force-gc.sh` | 0 | 199 | 0 | 1 |

Every rejection had the message `An error occurred while writing the PDF data`.

`print` on a Pixel 8 Pro, Android 17, expo-print 58.0.7. A `print` call settles when the dialog opens. The patched build has the change from "A fix that worked for us" below.

| Build | Button | Forced GCs | Dialog opened | Never settled | Rejected |
|---|---|---|---|---|---|
| Stock | printAsync | 0 | 200 | 0 | 0 |
| Stock | printAsync | 118 | 0 | 1 | 199 |
| Stock | nativePrint | 3,748 | 174 | 26 | 0 |
| Patched | nativePrint | 1,204 | 200 | 0 | 0 |
| Patched | printAsync | 1,189 | 200 | 0 | 0 |

In the stock `printAsync` run with forced GC, the first call never settled and the `isPrinting` guard rejected the other 199. The stock runs with forced GC took longer because each hang waits out the 20 second limit, so they logged more forced GCs in total. Neither build logged a print preview error while a dialog was open.

The forced GC makes the failure frequent enough to measure. We first saw it on physical Android phones, where a render sometimes never settled.

## Cause

In `PrintModule.printToFile`, the `PrintPDFRenderTask` exists only as a local variable. The HTML branch of `print` has the same code.

```kotlin
return@withContext suspendCancellableCoroutine { continuation ->
  val renderTask = PrintPDFRenderTask(context, options)
  renderTask.render(outputFile, fileDescriptor, createPrintToFileCallbacks(options, continuation))
}
```

`render` creates an off-screen `WebView` and returns. After that, no GC root reaches the task, its `WebView`, the `WebViewClient`, or the callbacks. The callbacks object refers to the continuation, but nothing refers to the callbacks object. If a GC collects them before `onPageFinished`, nothing resumes the continuation. In `print`, the dialog then never opens. In `printToFile`, a GC can also land during the write, and then `onWriteFailed` runs and the call rejects.

## A fix that worked for us

Keep each render task reachable until it settles:

```kotlin
private val activeRenderTasks: MutableSet<PrintPDFRenderTask> = ConcurrentHashMap.newKeySet()

// In printToFile, and the same in the HTML branch of print
val renderTask = PrintPDFRenderTask(context, options)
activeRenderTasks.add(renderTask)
continuation.invokeOnCancellation { activeRenderTasks.remove(renderTask) }
renderTask.render(outputFile, fileDescriptor, createPrintToFileCallbacks(options, continuation) {
  activeRenderTasks.remove(renderTask) // onRenderFinished and onRenderError call this first
})
```

In `print`, the task leaves the set in `onRenderFinished`, just before `PrintManager.print` takes the adapter.

For the `print` results above, we applied this change to `node_modules/expo-print` and built the app. Both builds also had the `publication` block removed from `expo-module.config.json`, so Gradle compiled expo-print from source and the Kotlin change was the only difference.

We also applied the change to expo-print 57.0.1 with a pnpm patch. The code it changes is the same in 58.0.7. We tested `printToFileAsync` on a Pixel 8 Pro under the same forced GC, running 6,940 renders with each build. Without the change, 375 renders never settled and 1,392 rejected. With the change, all 6,940 settled.
