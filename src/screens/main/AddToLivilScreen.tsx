import React from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { Icon, type IconName } from '../../components/Icon';
import { GradientBorder } from '../../components/GradientBorder';
import { SpotifyLogo } from '../../components/SpotifyLogo';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * "What do you want to add?" — opened by "+ Track" on your profile and "+" on Home while
 * Spotify reposts are switched on (ADR-0027). With the switch off those buttons skip this
 * screen and go straight to Upload, exactly as before.
 *
 * `replace`, not `navigate`: the chooser is a fork in the road, not a step. Cancelling the
 * upload (or the repost) should land you back where you started, not on this screen.
 */
export default function AddToLivilScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerSide}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Close"
        >
          <Icon name="close" size={22} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      <View style={styles.intro}>
        <Text style={styles.title}>What do you want to add?</Text>
        <Text style={styles.subtitle}>Share your own music, or a song you love from Spotify.</Text>
      </View>

      <View style={styles.options}>
        <Option
          primary
          icon="upload"
          title="Upload a track"
          body="Your own song or video, from your phone. Plays right here in Livil."
          onPress={() => navigation.replace('Upload')}
        />
        <Option
          icon="repost"
          title="Repost from Spotify"
          body="Search Spotify or paste a song link. Your friends play it in Spotify."
          footer={<SpotifyLogo size="xs" withName style={styles.logo} />}
          onPress={() => navigation.replace('SpotifyRepost', undefined)}
        />
      </View>
    </SafeAreaView>
  );
}

function Option({
  icon,
  title,
  body,
  footer,
  primary,
  onPress,
}: {
  icon: IconName;
  title: string;
  body: string;
  footer?: React.ReactNode;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { haptics.tap(); onPress(); }}
      style={({ pressed }) => [styles.option, primary && styles.optionPrimary, pressed && styles.optionPressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {primary ? <GradientBorder borderRadius={20} /> : null}
      <View style={[styles.optionIcon, primary && styles.optionIconPrimary]}>
        <Icon name={icon} size={24} color={primary ? COLORS.purpleNeon : COLORS.white} />
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionBody}>{body}</Text>
        {footer}
      </View>
      <Icon name="disclosure" size={18} color={COLORS.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: 'row' },
  headerSide: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  intro: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  title: { color: COLORS.white, fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
  options: { paddingHorizontal: 16, paddingTop: 28, gap: 14 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  // The gradient glow IS the border on the highlighted option; a grey one under it doubles up.
  optionPrimary: { borderWidth: 0 },
  optionPressed: { opacity: 0.85 },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconPrimary: { backgroundColor: COLORS.purpleDim },
  optionText: { flex: 1, gap: 4 },
  optionTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  optionBody: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  logo: { marginTop: 4 },
});
