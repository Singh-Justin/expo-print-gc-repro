# printToFileAsync hangs or fails on Android when a GC runs during the render

This is a blank Expo app (`npx create-expo-app@latest --template blank`) with `expo-print` 58.0.7 added. It has one button. The button calls `Print.printToFileAsync({ html })` 200 times in a row, one call at a time, on a plain HTML table. The app counts each call as settled, rejected, or never settled. A call that hasn't answered after 20 seconds counts as never settled.

On Android, a Java garbage collection during a render can make the call fail in one of two ways:

- The promise never settles.
- The promise rejects with `An error occurred while writing the PDF data`.

## Run it

```sh
npm install
npx expo run:android
```

`expo run:android` makes a debug build. `force-gc.sh` needs a debug build because it uses `run-as`.

In a second terminal, run `./force-gc.sh`. It sends `SIGUSR1` to the app about 10 times a second, and ART answers each signal with a forced GC. Logcat shows `SIGUSR1 forcing GC (no HPROF) and profile save` for each one. Press Ctrl+C to stop it.

Tap **Run 200 renders**. All 200 calls should settle. Instead, some never settle and some reject.

## Results

Pixel 9 Pro XL emulator, Android API 37, expo-print 58.0.7:

| Run | Forced GCs | Settled | Never settled | Rejected |
|---|---|---|---|---|
| With `force-gc.sh` | 409 | 161 | 4 | 35 |
| Without `force-gc.sh` | 0 | 199 | 0 | 1 |

Every rejection had the message `An error occurred while writing the PDF data`.

The forced GC makes the failure frequent enough to measure. We first saw it on physical Android phones, where a render sometimes never settled.

## Cause

In `PrintModule.printToFile`, the `PrintPDFRenderTask` exists only as a local variable. The HTML branch of `print` has the same code.

```kotlin
return@withContext suspendCancellableCoroutine { continuation ->
  val renderTask = PrintPDFRenderTask(context, options)
  renderTask.render(outputFile, fileDescriptor, createPrintToFileCallbacks(options, continuation))
}
```

`render` creates an off-screen `WebView` and returns. After that, no GC root reaches the task, its `WebView`, the `WebViewClient`, or the write callbacks. The callbacks object refers to the continuation, but nothing refers to the callbacks object. If a GC runs before `onWriteFinished`, it can collect all of them, and nothing resumes the continuation. If the GC runs during the write, `onWriteFailed` runs instead and the call rejects.

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

We applied this change to expo-print 57.0.1 with a pnpm patch. The code it changes is the same in 58.0.7. We tested it on a Pixel 8 Pro under the same forced GC, running 6,940 renders with each build. Without the change, 375 renders never settled and 1,392 rejected. With the change, all 6,940 settled.
