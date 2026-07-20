import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { COLORS } from '../../theme/colors';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { AuthStackParamList } from '../../navigation/types';

const { width } = Dimensions.get('window');

type Props = {
  navigation: StackNavigationProp<AuthStackParamList, 'Onboarding'>;
};

export default function OnboardingScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Decorative glow orbs */}
      <View style={styles.orbContainer} pointerEvents="none">
        <View style={styles.orbOuter} />
        <View style={styles.orbMiddle} />
        <View style={styles.orbInner} />
      </View>

      {/* Hero */}
      <View style={styles.heroSection}>
        <View style={styles.notesRow}>
          <Icon name="musicNote" size={30} color="rgba(167, 139, 250, 0.55)" />
          <Icon name="musicNotes" size={24} color="rgba(167, 139, 250, 0.35)" />
        </View>
        <Text style={styles.logoText}>livil</Text>
        <View style={styles.logoDivider} />
        <Text style={styles.tagline}>Your music, your world.</Text>
        <Text style={styles.caption}>Live . Vibe . Link</Text>
      </View>

      {/* Bottom CTA */}
      <View style={styles.bottomSection}>
        <Text style={styles.description}>
          Discover, stream, and share music{'\n'}with millions worldwide.
        </Text>

        <Button
          label="Sign In"
          onPress={() => navigation.navigate('SignIn')}
          variant="primary"
          size="lg"
          fullWidth
        />

        <Button
          label="Create Account"
          onPress={() => navigation.navigate('SignUp')}
          variant="secondary"
          size="lg"
          fullWidth
          style={styles.signUpButton}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  orbContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
  },
  orbOuter: {
    position: 'absolute',
    width: width * 1.1,
    height: width * 1.1,
    borderRadius: (width * 1.1) / 2,
    backgroundColor: 'rgba(139, 61, 255, 0.07)',
    top: -width * 0.45,
    alignSelf: 'center',
  },
  orbMiddle: {
    position: 'absolute',
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: (width * 0.7) / 2,
    backgroundColor: 'rgba(139, 61, 255, 0.13)',
    top: -width * 0.2,
    alignSelf: 'center',
  },
  orbInner: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(139, 61, 255, 0.22)',
    top: 30,
    alignSelf: 'center',
  },
  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
  },
  notesRow: {
    flexDirection: 'row',
    width: 160,
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  logoText: {
    fontSize: 88,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -3,
  },
  logoDivider: {
    width: 56,
    height: 3,
    backgroundColor: COLORS.purple,
    borderRadius: 2,
    marginTop: 6,
    marginBottom: 18,
  },
  tagline: {
    fontSize: 17,
    color: COLORS.textSecondary,
    letterSpacing: 0.4,
  },
  caption: {
    fontSize: 12,
    color: COLORS.purple,
    letterSpacing: 3,
    fontWeight: '600',
    marginTop: 10,
    textTransform: 'uppercase',
  },
  bottomSection: {
    paddingHorizontal: 28,
    paddingBottom: 16,
    gap: 14,
  },
  description: {
    fontSize: 15,
    color: '#5C6380',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 6,
  },
  signUpButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
});
