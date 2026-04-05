import { useRef, useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';

const BETKING_URL = 'https://m.betking.com/en-ng/virtuals/instant/leagues/kings-instaleague';

// JavaScript injected into WebView to extract all useful selectors
const SELECTOR_DEBUG_JS = `
(function() {
  function getSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).filter(c => c && !c.match(/^[0-9]/)).slice(0, 3).join('.');
      if (classes) {
        const sel = el.tagName.toLowerCase() + '.' + classes;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    return null;
  }

  function extractSelectors() {
    const data = {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      buttons: [],
      inputs: [],
      odds: [],
      markets: [],
      betslip: [],
      balance: [],
      navigation: [],
      iframes: [],
      interactable: [],
    };

    // All buttons
    document.querySelectorAll('button, [role="button"], a.btn, .btn, [class*="button"], [class*="Button"]').forEach(el => {
      data.buttons.push({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 60),
        selector: getSelector(el),
        id: el.id || null,
        class: (el.className || '').toString().substring(0, 80),
        disabled: el.disabled || false,
        visible: el.offsetParent !== null,
      });
    });

    // All inputs
    document.querySelectorAll('input, textarea, select').forEach(el => {
      data.inputs.push({
        tag: el.tagName,
        type: el.type || null,
        name: el.name || null,
        placeholder: el.placeholder || null,
        selector: getSelector(el),
        id: el.id || null,
        class: (el.className || '').toString().substring(0, 80),
        value: el.value || '',
      });
    });

    // Odds elements
    document.querySelectorAll('[class*="odd"], [class*="Odd"], [class*="price"], [class*="Price"], [class*="coefficient"]').forEach(el => {
      data.odds.push({
        text: (el.textContent || '').trim().substring(0, 30),
        selector: getSelector(el),
        class: (el.className || '').toString().substring(0, 80),
      });
    });

    // Market/match elements
    document.querySelectorAll('[class*="match"], [class*="Match"], [class*="event"], [class*="Event"], [class*="fixture"], [class*="league"]').forEach(el => {
      if ((el.textContent || '').trim().length < 200) {
        data.markets.push({
          text: (el.textContent || '').trim().substring(0, 100),
          selector: getSelector(el),
          class: (el.className || '').toString().substring(0, 80),
        });
      }
    });

    // Betslip elements
    document.querySelectorAll('[class*="slip"], [class*="Slip"], [class*="stake"], [class*="Stake"], [class*="coupon"], [class*="Coupon"], [class*="bet-"], [class*="Bet"]').forEach(el => {
      data.betslip.push({
        text: (el.textContent || '').trim().substring(0, 80),
        selector: getSelector(el),
        class: (el.className || '').toString().substring(0, 80),
        tag: el.tagName,
      });
    });

    // Balance elements
    document.querySelectorAll('[class*="balance"], [class*="Balance"], [class*="wallet"], [class*="Wallet"], [class*="amount"], [class*="Amount"]').forEach(el => {
      data.balance.push({
        text: (el.textContent || '').trim().substring(0, 50),
        selector: getSelector(el),
        class: (el.className || '').toString().substring(0, 80),
      });
    });

    // Navigation elements
    document.querySelectorAll('nav, [class*="nav"], [class*="Nav"], [class*="tab"], [class*="Tab"], [class*="menu"], [class*="Menu"]').forEach(el => {
      if ((el.textContent || '').trim().length < 100) {
        data.navigation.push({
          text: (el.textContent || '').trim().substring(0, 60),
          selector: getSelector(el),
          class: (el.className || '').toString().substring(0, 80),
        });
      }
    });

    // Iframes
    document.querySelectorAll('iframe').forEach(el => {
      data.iframes.push({
        src: el.src || null,
        id: el.id || null,
        class: (el.className || '').toString().substring(0, 80),
      });
    });

    // All clickable elements with data attributes
    document.querySelectorAll('[data-testid], [data-id], [data-event-id], [data-market-id], [data-selection-id]').forEach(el => {
      const attrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) attrs[attr.name] = attr.value;
      }
      data.interactable.push({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 60),
        selector: getSelector(el),
        attrs,
      });
    });

    // Cookies
    data.cookies = document.cookie.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return { name: name.trim(), value: rest.join('=').substring(0, 30) + '...' };
    });

    return data;
  }

  try {
    const result = extractSelectors();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'selectors', data: result }));
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: e.message }));
  }
})();
true;
`;

export default function App() {
  const webViewRef = useRef(null);
  const [isRunning, setIsRunning] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [pageLoaded, setPageLoaded] = useState(false);

  const handleMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'selectors') {
        setDebugInfo(msg.data);
        console.log('\n========== BETKING SELECTORS DEBUG ==========');
        console.log('URL:', msg.data.url);
        console.log('Title:', msg.data.title);
        console.log('\n--- BUTTONS (' + msg.data.buttons.length + ') ---');
        msg.data.buttons.forEach((b, i) => {
          if (b.visible) console.log(`  [${i}] "${b.text}" → ${b.selector || b.class}`);
        });
        console.log('\n--- INPUTS (' + msg.data.inputs.length + ') ---');
        msg.data.inputs.forEach((inp, i) => {
          console.log(`  [${i}] type=${inp.type} name=${inp.name} placeholder="${inp.placeholder}" → ${inp.selector || inp.id}`);
        });
        console.log('\n--- ODDS (' + msg.data.odds.length + ') ---');
        msg.data.odds.slice(0, 20).forEach((o, i) => {
          console.log(`  [${i}] "${o.text}" → ${o.selector || o.class}`);
        });
        console.log('\n--- MARKETS (' + msg.data.markets.length + ') ---');
        msg.data.markets.slice(0, 15).forEach((m, i) => {
          console.log(`  [${i}] "${m.text}" → ${m.selector || m.class}`);
        });
        console.log('\n--- BETSLIP (' + msg.data.betslip.length + ') ---');
        msg.data.betslip.slice(0, 10).forEach((s, i) => {
          console.log(`  [${i}] "${s.text}" → ${s.selector || s.class}`);
        });
        console.log('\n--- BALANCE (' + msg.data.balance.length + ') ---');
        msg.data.balance.forEach((b, i) => {
          console.log(`  [${i}] "${b.text}" → ${b.selector || b.class}`);
        });
        console.log('\n--- NAVIGATION (' + msg.data.navigation.length + ') ---');
        msg.data.navigation.slice(0, 10).forEach((n, i) => {
          console.log(`  [${i}] "${n.text}" → ${n.selector || n.class}`);
        });
        console.log('\n--- IFRAMES (' + msg.data.iframes.length + ') ---');
        msg.data.iframes.forEach((f, i) => {
          console.log(`  [${i}] src=${f.src} id=${f.id}`);
        });
        console.log('\n--- DATA ATTRIBUTES (' + msg.data.interactable.length + ') ---');
        msg.data.interactable.slice(0, 20).forEach((el, i) => {
          console.log(`  [${i}] "${el.text}" → ${JSON.stringify(el.attrs)}`);
        });
        console.log('\n--- COOKIES (' + msg.data.cookies.length + ') ---');
        msg.data.cookies.forEach((c, i) => {
          console.log(`  [${i}] ${c.name} = ${c.value}`);
        });
        console.log('==============================================\n');
      } else if (msg.type === 'error') {
        console.log('WebView Error:', msg.message);
      }
    } catch (e) {
      console.log('Message parse error:', e.message);
    }
  }, []);

  const handleLoadEnd = useCallback(() => {
    setPageLoaded(true);
    // Auto-run selector debug after page loads
    setTimeout(() => {
      webViewRef.current?.injectJavaScript(SELECTOR_DEBUG_JS);
    }, 3000);
  }, []);

  const toggleBot = () => {
    setIsRunning((prev) => !prev);
    if (!isRunning) {
      console.log('🟢 Bot STARTED');
    } else {
      console.log('🔴 Bot STOPPED');
    }
  };

  const refreshSelectors = () => {
    webViewRef.current?.injectJavaScript(SELECTOR_DEBUG_JS);
    console.log('🔄 Refreshing selectors...');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>BetKing Virtual</Text>
        <View style={styles.headerRight}>
          {pageLoaded && (
            <TouchableOpacity style={styles.debugBtn} onPress={refreshSelectors}>
              <Text style={styles.debugBtnText}>Debug</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.toggleBtn, isRunning ? styles.toggleBtnStop : styles.toggleBtnStart]}
            onPress={toggleBot}
          >
            <Text style={styles.toggleBtnText}>
              {isRunning ? '■ Stop' : '▶ Start'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status bar */}
      <View style={[styles.statusBar, isRunning ? styles.statusRunning : styles.statusStopped]}>
        <View style={[styles.statusDot, isRunning ? styles.dotGreen : styles.dotGray]} />
        <Text style={styles.statusText}>
          {isRunning ? 'Bot Running' : 'Bot Stopped'}
          {debugInfo ? ` | ${debugInfo.buttons.length} buttons, ${debugInfo.odds.length} odds found` : ''}
        </Text>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: BETKING_URL }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="compatibility"
        originWhitelist={['*']}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  headerTitle: {
    color: '#e94560',
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  debugBtn: {
    backgroundColor: '#0f3460',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  debugBtnText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  toggleBtnStart: {
    backgroundColor: '#00b894',
  },
  toggleBtnStop: {
    backgroundColor: '#e94560',
  },
  toggleBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  statusRunning: {
    backgroundColor: '#0a3d2a',
  },
  statusStopped: {
    backgroundColor: '#2d1a1a',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#00b894',
  },
  dotGray: {
    backgroundColor: '#666',
  },
  statusText: {
    color: '#999',
    fontSize: 11,
  },
  webview: {
    flex: 1,
  },
});
