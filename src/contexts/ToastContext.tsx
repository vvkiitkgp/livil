import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from '../components/Icon';

export type ToastKind = 'error' | 'success' | 'info';

type ToastOptions = {
  kind?: ToastKind;
  duration?: number;
};

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

type ActiveToast = {
  id: number;
  message: string;
  kind: ToastKind;
  duration: number;
};

const DEFAULT_DURATION = 4000;
const ENTER_MS = 220;
const EXIT_MS = 180;
// Native-stack header sits below the status bar. 56dp is the Android default;
// also clears iOS's 44pt header with room to spare.
const HEADER_OFFSET = 56 + 8;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounter = useRef(0);

  const clearTimer = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const hide = useCallback(() => {
    clearTimer();
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: EXIT_MS, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -20, duration: EXIT_MS, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) { setToast(null); }
    });
  }, [opacity, translateY]);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      clearTimer();
      idCounter.current += 1;
      const next: ActiveToast = {
        id: idCounter.current,
        message,
        kind: options?.kind ?? 'info',
        duration: options?.duration ?? DEFAULT_DURATION,
      };
      setToast(next);
      opacity.setValue(0);
      translateY.setValue(-20);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: ENTER_MS, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: ENTER_MS, useNativeDriver: true }),
      ]).start();
      dismissTimer.current = setTimeout(hide, next.duration);
    },
    [opacity, translateY, hide],
  );

  useEffect(() => () => clearTimer(), []);

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  const palette = toast ? KIND_STYLES[toast.kind] : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && palette ? (
        <View
          pointerEvents="box-none"
          style={[styles.layer, { paddingTop: insets.top + HEADER_OFFSET }]}
        >
          <Animated.View
            style={[
              styles.toast,
              {
                borderColor: palette.border,
                opacity,
                transform: [{ translateY }],
              },
            ]}
          >
            <Pressable onPress={hide} style={styles.pressable}>
              <View style={styles.glyph}>
                <Icon name={palette.icon} size={15} color={palette.glyph} />
              </View>
              <Text style={styles.message} numberOfLines={1}>
                {toast.message}
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

const KIND_STYLES: Record<ToastKind, { border: string; glyph: string; icon: IconName }> = {
  error: { border: 'rgba(239, 68, 68, 0.55)', glyph: COLORS.error, icon: 'error' },
  success: { border: 'rgba(34, 197, 94, 0.55)', glyph: '#22C55E', icon: 'check' },
  info: { border: COLORS.infoBorder, glyph: COLORS.info, icon: 'info' },
};

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
    maxWidth: '100%',
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: COLORS.card,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
  },
  glyph: {
    fontSize: 15,
    fontWeight: '800',
    width: 14,
    textAlign: 'center',
  },
  message: {
    color: COLORS.white,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
});
