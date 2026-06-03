import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export default function AppNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Home"
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
  tabBar: {
    position: 'absolute',
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
