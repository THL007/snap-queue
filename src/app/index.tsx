import { Platform, StatusBar, View } from "react-native";
import SnapQueue from "../components/SnapQueue";

// Web renders the DOM component directly. Android and iOS host the same screen in a WebView (Expo DOM components).
export default function Index() {
  if (Platform.OS === "web") return <SnapQueue />;
  return (
    <View style={{ flex: 1, backgroundColor: "#f7f4ec" }}>
      <StatusBar barStyle="dark-content" />
      <SnapQueue dom={{ style: { flex: 1 }, contentInsetAdjustmentBehavior: "automatic", bounces: false }} />
    </View>
  );
}
