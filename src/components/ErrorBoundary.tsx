import React from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView } from 'react-native';
import { COLORS } from '../theme/colors';

/**
 * Catches render-phase errors so a thrown component does not take down the app.
 *
 * Without this, any error during render unmounts the whole tree and the user sees
 * a white screen with no way forward. There is currently no crash reporting, so
 * such a failure also produces no signal at all — the user simply loses the app.
 *
 * `onError` is the hook for a reporting service when one is added. Until then the
 * error is logged and shown to the user in dev builds only.
 */

type Props = {
  children: React.ReactNode;
  /** Called on every caught error. Wire crash reporting here. */
  onError?: (error: Error, componentStack: string) => void;
};

type State = {
  error: Error | null;
  componentStack: string | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const componentStack = info?.componentStack ?? '';
    this.setState({ componentStack });

    // Always log — this is the only signal that exists today.
    console.error('[ErrorBoundary] render error:', error, componentStack);

    try {
      this.props.onError?.(error, componentStack);
    } catch {
      // A failing reporter must never mask the original error.
    }
  }

  private reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected error. Your account and music are safe.
          </Text>

          {__DEV__ && (
            <ScrollView style={styles.details} contentContainerStyle={styles.detailsContent}>
              <Text style={styles.errorText}>{String(error?.message ?? error)}</Text>
              {!!componentStack && <Text style={styles.stackText}>{componentStack}</Text>}
            </ScrollView>
          )}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Try again">
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 24,
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  details: {
    maxHeight: 200,
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  detailsContent: { padding: 12 },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  stackText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: COLORS.purple,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: COLORS.purple,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
