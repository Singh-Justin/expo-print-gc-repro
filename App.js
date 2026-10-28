import { StatusBar } from 'expo-status-bar';
import * as Print from 'expo-print';
import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

const RUNS = 200;
// A render with no answer after this long is counted as never settled.
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

async function renderOnce() {
  let timer;
  const neverSettled = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ outcome: 'neverSettled' }), NEVER_SETTLED_MS);
  });
  const render = Print.printToFileAsync({ html }).then(
    () => ({ outcome: 'settled' }),
    (error) => ({ outcome: 'rejected', error: String(error?.message ?? error) })
  );
  const result = await Promise.race([render, neverSettled]);
  clearTimeout(timer);
  return result;
}

export default function App() {
  const [running, setRunning] = useState(false);
  const [tally, setTally] = useState({ settled: 0, neverSettled: 0, rejected: 0 });
  const [log, setLog] = useState([]);

  const run = async () => {
    setRunning(true);
    const counts = { settled: 0, neverSettled: 0, rejected: 0 };
    setTally({ ...counts });
    setLog([]);
    console.log(`[repro] start ${RUNS} renders`);
    for (let i = 1; i <= RUNS; i += 1) {
      // One render at a time; nothing runs in parallel.
      const { outcome, error } = await renderOnce();
      counts[outcome] += 1;
      setTally({ ...counts });
      if (outcome !== 'settled') {
        const line = `run ${i}: ${outcome}${error ? ` (${error})` : ''}`;
        console.log(`[repro] ${line}`);
        setLog((previous) => [line, ...previous]);
      }
    }
    console.log(`[repro] done ${JSON.stringify(counts)}`);
    setRunning(false);
  };

  return (
    <View style={styles.container}>
      <Button title={running ? 'Running…' : `Run ${RUNS} renders`} onPress={run} disabled={running} />
      <Text style={styles.tally}>
        settled {tally.settled} · never settled {tally.neverSettled} · rejected {tally.rejected}
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
  tally: { marginTop: 16, fontSize: 16 },
  log: { marginTop: 16 },
});
