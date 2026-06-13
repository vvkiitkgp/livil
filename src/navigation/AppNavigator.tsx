import React from 'react';
import { View, StyleSheet, Platform, Animated } from 'react-native';
import {
  createBottomTabNavigator,
  BottomTabBar,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChromeVisibility } from '../contexts/ChromeVisibilityContext';
import HomeScreen from '../screens/main/HomeScreen';
import SearchScreen from '../screens/main/SearchScreen';
import LibraryScreen from '../screens/main/LibraryScreen';
import ProfileScreen from '../screens/main/ProfileScreen';
import { COLORS } from '../theme/colors';
import { AppTabParamList } from './types';

const Tab = createBottomTabNavigator<AppTabParamList>();

type IconProps = { color: string; focused: boolean };

function HomeIcon({ color, focused }: IconProps) {
  return (
    <View style={iconStyles.wrap}>
      <View
        style={[
          iconStyles.homeRoof,
          { borderBottomColor: color },
        ]}
      />
      <View
        style={[
          iconStyles.homeBody,
          { borderColor: color, backgroundColor: focused ? color : 'transparent' },
        ]}
      />
    </View>
  );
}

function SearchIcon({ color, focused }: IconProps) {
  return (
    <View style={iconStyles.wrap}>
      <View
        style={[
          iconStyles.searchCircle,
          {
            borderColor: color,
            backgroundColor: focused ? color : 'transparent',
          },
        ]}
      />
      <View style={[iconStyles.searchHandle, { backgroundColor: color }]} />
    </View>
  );
}

function LibraryIcon({ color, focused }: IconProps) {
  return (
    <View style={iconStyles.wrap}>
      <View style={iconStyles.libraryRows}>
        <View
          style={[
            iconStyles.libraryBar,
            { backgroundColor: focused ? color : 'transparent', borderColor: color },
          ]}
        />
        <View
          style={[
            iconStyles.libraryBar,
            { backgroundColor: focused ? color : 'transparent', borderColor: color },
          ]}
        />
        <View
          style={[
            iconStyles.libraryBar,
            { backgroundColor: focused ? color : 'transparent', borderColor: color },
          ]}
        />
      </View>
    </View>
  );
}

function ProfileIcon({ color, focused }: IconProps) {
  return (
    <View style={iconStyles.wrap}>
      <View
        style={[
          iconStyles.profileHead,
          {
            borderColor: color,
            backgroundColor: focused ? color : 'transparent',
          },
        ]}
      />
      <View
        style={[
          iconStyles.profileBody,
          {
            borderColor: color,
            backgroundColor: focused ? color : 'transparent',
          },
        ]}
      />
    </View>
  );
}

// Bottom tab bar wrapped in an Animated.View so it can slide off the bottom edge
// when the user scrolls down through the feed (Home / Profile), and pop back the
// instant they scroll up. Driven by the shared ChromeVisibility anim so it stays
// in lock-step with the floating music player. The wrapper owns the absolute
// bottom positioning (tabBarStyle is laid out in normal flow inside it).
function AnimatedTabBar(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { hiddenAnim } = useChromeVisibility();
  const tabBarH =
    Platform.OS === 'ios' ? 84 : 64 + insets.bottom + 16;
  const translateY = hiddenAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabBarH + 24], // fully clears the bar + its top border
  });
  return (
    <Animated.View style={[styles.tabBarWrap, { transform: [{ translateY }] }]}>
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

export default function AppNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Home"
      tabBar={props => <AnimatedTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: COLORS.purpleLight,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: [
          styles.tabBar,
          Platform.OS === 'android' && {
            height: 64 + insets.bottom + 16,
            paddingBottom: 8 + insets.bottom + 16,
          },
        ],
        tabBarItemStyle: styles.tabItem,
        tabBarBackground: () => <View style={styles.tabBarBg} />,
        sceneStyle: { backgroundColor: COLORS.bg },
        // Default lazy=true: mounting Profile (many videos) while Home is visible
        // starves Android audio focus — Home playback dies after ~1s.
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: HomeIcon }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ tabBarIcon: SearchIcon }}
      />
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{ tabBarIcon: LibraryIcon }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ProfileIcon }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  // Absolute container for the tab bar — the AnimatedTabBar translates this to
  // slide the bar off the bottom edge. The bar itself (styles.tabBar) lays out
  // in normal flow inside it.
  tabBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  tabBar: {
    backgroundColor: 'transparent',
    borderTopColor: 'rgba(124, 58, 237, 0.25)',
    borderTopWidth: StyleSheet.hairlineWidth,
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    // Android height/paddingBottom are overridden in screenOptions with insets.bottom
  },
  tabBarBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10, 10, 15, 0.90)',
    borderTopColor: 'rgba(124, 58, 237, 0.25)',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 2,
  },
});

const iconStyles = StyleSheet.create({
  wrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  homeRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: -1,
  },
  homeBody: {
    width: 16,
    height: 10,
    borderWidth: 2,
    borderTopWidth: 0,
    borderRadius: 1,
  },

  searchCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    marginTop: -2,
    marginLeft: -2,
  },
  searchHandle: {
    position: 'absolute',
    width: 7,
    height: 2,
    borderRadius: 1,
    bottom: 5,
    right: 4,
    transform: [{ rotate: '45deg' }],
  },

  libraryRows: {
    width: 18,
    height: 16,
    justifyContent: 'space-between',
  },
  libraryBar: {
    height: 3,
    borderRadius: 1.5,
    borderWidth: 1.5,
  },

  profileHead: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 2,
  },
  profileBody: {
    width: 16,
    height: 9,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 2,
    borderBottomWidth: 0,
    marginTop: 2,
  },
});
