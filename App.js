import { requireNativeModule } from 'expo';
import { StatusBar } from 'expo-status-bar';
import * as Print from 'expo-print';
import { useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';

const RUNS = 200;
// The app counts a call with no answer after this long as never settled.
const NEVER_SETTLED_MS = 20000;

// A plain multi-page table, similar in size to an invoice or report.
const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: sans-serif; font-size: 11px; margin: 24px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
    </style>
  </head>
  <body>
    <h1>Report</h1>
    <table>
      <thead><tr><th>#</th><th>Item</th><th>Description</th></tr></thead>
      <tbody>
        ${Array.from(
          { length: 150 },
          (_, i) => `<tr><td>${i + 1}</td><td>Item ${i + 1}</td><td>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</td></tr>`
        ).join('')}
      </tbody>
    </table>
  </body>
</html>`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves once AppState matches, or after timeoutMs. Returns whether it matched.
function waitForAppState(matches, timeoutMs) {
  if (matches(AppState.currentState)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.remove();
      resolve(false);
    }, timeoutMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (matches(state)) {
        clearTimeout(timer);
        subscription.remove();
        resolve(true);
      }
    });
  });
}

const CALLS = {
  printToFileAsync: () => Print.printToFileAsync({ html }),
  // printAsync resolves once the system print dialog is launched. Close the dialog with Back
  // (or run ./dismiss-print-dialog.sh) and the next call starts when the app is active again.
  printAsync: () => Print.printAsync({ html }),
  // The native print call without printAsync's JS guard. After one call never settles, the guard
  // rejects every later printAsync with "Another print request is already in progress", so this
  // mode is what counts each call on its own.
  nativePrint: () => requireNativeModule('ExpoPrint').print({ html }),
};

async function callOnce(method) {
  let timer;
  const neverSettled = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ outcome: 'neverSettled' }), NEVER_SETTLED_MS);
  });
  const call = CALLS[method]().then(
    () => ({ outcome: 'settled' }),
    (error) => ({ outcome: 'rejected', error: String(error?.message ?? error) })
  );
  const result = await Promise.race([call, neverSettled]);
  clearTimeout(timer);
  return result;
}

export default function App() {
  const [running, setRunning] = useState(null);
  const [tally, setTally] = useState({ settled: 0, neverSettled: 0, rejected: 0 });
  const [log, setLog] = useState([]);

  const run = async (method) => {
    setRunning(method);
    const counts = { settled: 0, neverSettled: 0, rejected: 0 };
    let dialogsNotShown = 0;
    setTally({ ...counts });
    setLog([]);
    console.log(`[repro] start ${method} ${RUNS} calls`);
    for (let i = 1; i <= RUNS; i += 1) {
      // One call at a time; nothing runs in parallel.
      const { outcome, error } = await callOnce(method);
      counts[outcome] += 1;
      setTally({ ...counts });
      if (outcome !== 'settled') {
        const line = `${method} run ${i}: ${outcome}${error ? ` (${error})` : ''}`;
        console.log(`[repro] ${line}`);
        setLog((previous) => [line, ...previous]);
      }
      if (method !== 'printToFileAsync' && outcome === 'settled') {
        // Wait for the print dialog to cover the app, then for the app to come back.
        const left = await waitForAppState((state) => state !== 'active', 5000);
        if (!left) {
          dialogsNotShown += 1;
          console.log(`[repro] printAsync run ${i}: print dialog did not open`);
        }
        await waitForAppState((state) => state === 'active', 60000);
        await delay(300);
      }
    }
    console.log(`[repro] done ${method} ${JSON.stringify({ ...counts, dialogsNotShown })}`);
    setRunning(null);
  };

  return (
    <View style={styles.container}>
      <Button
        title={`Run ${RUNS} printToFileAsync calls`}
        onPress={() => run('printToFileAsync')}
        disabled={running !== null}
      />
      <View style={styles.gap} />
      <Button title={`Run ${RUNS} printAsync calls`} onPress={() => run('printAsync')} disabled={running !== null} />
      <View style={styles.gap} />
      <Button title={`Run ${RUNS} nativePrint calls`} onPress={() => run('nativePrint')} disabled={running !== null} />
      <Text style={styles.tally}>
        {running ? `${running}: ` : ''}settled {tally.settled} · never settled {tally.neverSettled} · rejected{' '}
        {tally.rejected}
      </Text>
      <ScrollView style={styles.log}>
        {log.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 80, paddingHorizontal: 24 },
  gap: { height: 12 },
  tally: { marginTop: 16, fontSize: 16 },
  log: { marginTop: 16 },
});
