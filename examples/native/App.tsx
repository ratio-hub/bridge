import { useCallback, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import { nativeContract, webContract } from "@ratio-hub/bridge-example-shared";
import { BridgeError } from "@ratio-hub/bridge";
import type { InferHandlers } from "@ratio-hub/bridge";
import {
  useBridge,
  useBridgeHandler,
  useBridgeClient,
} from "@ratio-hub/bridge/react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
const WEB_URL = Platform.select({
  default: "http://192.168.0.180:5173",
});

const MAX_LOGS = 20;

export default function App() {
  const [counter, setCounter] = useState(0);
  const counterRef = useRef(0);

  const [activeTab, setActiveTab] = useState<"home" | "settings">("home");
  const activeTabRef = useRef<"home" | "settings">("home");

  const [modalVisible, setModalVisible] = useState(false);
  const modalResolverRef = useRef<((result: string) => void) | null>(null);

  const [theme, setTheme] = useState<{
    mode: string;
    primaryColor: string;
  } | null>(null);

  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) =>
      [`[${timestamp}] ${message}`, ...prev].slice(0, MAX_LOGS),
    );
  }, []);

  const nativeHandlers: InferHandlers<typeof nativeContract> = useMemo(
    () => ({
      device: {
        getInfo: () => {
          addLog("device.getInfo");
          return {
            platform: Platform.OS as "ios" | "android",
            osVersion: Platform.Version?.toString() ?? "unknown",
            appVersion: "1.0.0",
            deviceName: Platform.select({
              ios: "iPhone",
              android: "Android Device",
              default: "Device",
            })!,
          };
        },
      },
      modal: {
        open: () => {
          addLog("modal.open → showing modal");
          return new Promise<{ result: string }>((resolve) => {
            modalResolverRef.current = (result: string) => {
              addLog(`modal.open → resolved: ${result}`);
              resolve({ result });
            };
            setModalVisible(true);
          });
        },
      },
      modalTimeout: {
        open: () => {
          addLog("modalTimeout.open → delaying 3s (will timeout)");
          return new Promise<{ result: string }>((resolve) => {
            setTimeout(() => {
              addLog("modalTimeout.open → resolved (too late)");
              resolve({ result: "delayed response" });
            }, 3000);
          });
        },
      },
      haptic: {
        trigger: ({ input }) => {
          addLog(`haptic.trigger → ${input.style}`);
          Haptics.impactAsync(
            Haptics.ImpactFeedbackStyle[
              input.style as keyof typeof Haptics.ImpactFeedbackStyle
            ],
          );
        },
      },
      hapticDelayed: {
        trigger: ({ input }) => {
          addLog(`hapticDelayed.trigger → ${input.style} (1s delay)`);
          return new Promise<{ triggeredAt: number }>((resolve) => {
            setTimeout(() => {
              const now = Date.now();
              addLog(`hapticDelayed.trigger → done at ${now}`);
              Haptics.impactAsync(
                Haptics.ImpactFeedbackStyle[
                  input.style as keyof typeof Haptics.ImpactFeedbackStyle
                ],
              );
              resolve({ triggeredAt: now });
            }, 1000);
          });
        },
      },
      tabs: {
        change: ({ input }) => {
          activeTabRef.current = input.tab;
          setActiveTab(input.tab);
          addLog(`tabs.change → ${input.tab}`);
          return { activeTab: input.tab };
        },
      },
      counter: {
        increment: () => {
          counterRef.current += 1;
          setCounter(counterRef.current);
          addLog(`counter.increment → ${counterRef.current}`);
          return { value: counterRef.current };
        },
        decrement: () => {
          counterRef.current -= 1;
          setCounter(counterRef.current);
          addLog(`counter.decrement → ${counterRef.current}`);
          return { value: counterRef.current };
        },
      },
      error: {
        trigger: ({ input }) => {
          if (input.shouldFail) {
            addLog("error.trigger → throwing OPERATION_FAILED");
            throw new BridgeError("OPERATION_FAILED", {
              message: "Something went wrong on native side",
              code: 500,
            });
          }
          addLog("error.trigger → success");
          return { success: true };
        },
      },
    }),
    [addLog],
  );

  const webViewRef = useRef<WebView>(null);
  const { transport, dispatch } = useBridge((data) =>
    webViewRef.current?.postMessage(data),
  );

  useBridgeHandler(nativeContract, nativeHandlers, transport);
  const client = useBridgeClient(webContract, transport);

  const handleLoad = useCallback(() => {
    setTimeout(async () => {
      try {
        const result = await client.theme.get();
        setTheme(result);
        addLog(`theme.get → ${result.mode} (${result.primaryColor})`);
      } catch (err) {
        console.warn("[Bridge] Failed to get theme:", err);
      }
    }, 500);
  }, [client, addLog]);

  const handleModalResponse = useCallback((result: string) => {
    setModalVisible(false);
    modalResolverRef.current?.(result);
    modalResolverRef.current = null;
  }, []);

  const handleSendNotification = useCallback(() => {
    client.notification.show({
      title: "Hello from Native",
      message: `Notification sent at ${new Date().toLocaleTimeString()}`,
    });
    addLog("notification.show → sent to web");
  }, [client, addLog]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.topHalf}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Bridge Native</Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Counter</Text>
            <Text style={styles.counterValue}>{counter}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Active Tab</Text>
            <Text style={styles.cardValue}>{activeTab}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Web Theme</Text>
            <Text style={styles.cardValue}>
              {theme ? `${theme.mode} (${theme.primaryColor})` : "Loading..."}
            </Text>
          </View>

          <Pressable style={styles.button} onPress={handleSendNotification}>
            <Text style={styles.buttonText}>Send Notification to Web</Text>
          </Pressable>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Activity Log</Text>
            {logs.length === 0 ? (
              <Text style={styles.logEmpty}>No activity yet</Text>
            ) : (
              logs.map((log, i) => (
                <Text key={i} style={styles.logText}>
                  {log}
                </Text>
              ))
            )}
          </View>
        </ScrollView>
      </View>

      <View style={styles.divider} />

      <View style={styles.bottomHalf}>
        <WebView
          ref={webViewRef}
          source={{ uri: WEB_URL }}
          style={styles.webview}
          onMessage={(e) => dispatch(e.nativeEvent.data)}
          onLoad={handleLoad}
        />
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => handleModalResponse("cancelled")}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Native Modal</Text>
            <Text style={styles.modalBody}>
              This modal was triggered from the web app via a bridge procedure.
              Tap a button to send the result back.
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.button, styles.modalButtonCancel]}
                onPress={() => handleModalResponse("cancelled")}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.button}
                onPress={() => handleModalResponse("confirmed")}
              >
                <Text style={styles.buttonText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  topHalf: {
    flex: 1,
  },
  bottomHalf: {
    flex: 1,
  },
  divider: {
    height: 2,
    backgroundColor: "#ddd",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  counterValue: {
    fontSize: 32,
    fontWeight: "700",
    textAlign: "center",
    color: "#333",
  },
  button: {
    backgroundColor: "#646cff",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  logEmpty: {
    color: "#aaa",
    fontSize: 12,
    fontStyle: "italic",
  },
  logText: {
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    color: "#555",
    lineHeight: 16,
  },
  webview: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalBody: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
  },
  modalButtonCancel: {
    backgroundColor: "#888",
  },
});
