import React from 'react';
import { StyleSheet, Platform, Animated, Pressable } from 'react-native';
import {
  createBottomTabNavigator,
  BottomTabBar,
  type BottomTabBarButtonProps,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChromeVisibility } from '../contexts/ChromeVisibilityContext';
import HomeScreen from '../screens/main/HomeScreen';
import SearchScreen from '../screens/main/SearchScreen';
import InboxScreen from '../screens/main/InboxScreen';
import LibraryScreen from '../screens/main/LibraryScreen';
import ProfileScreen from '../screens/main/ProfileScreen';
import { COLORS } from '../theme/colors';
import { haptics } from '../utils/haptics';
import { AppTabParamList } from './types';
import { Icon } from '../components/Icon';
import MessagesTabIcon from '../components/MessagesTabIcon';
import TabAvatar from '../components/TabAvatar';
import TabBarBackground from '../components/TabBarBackground';
import { UnreadBadgeProvider } from '../contexts/UnreadBadgeContext';
import TabSwipeBack from './TabSwipeBack';

const Tab = createBottomTabNavigator<AppTabParamList>();

type TabIconProps = { color: string; focused: boolean };

function HomeIcon({ color, focused }: TabIconProps) {
  return <Icon name="home" size={26} color={color} weight={focused ? 'fill' : 'regular'} />;
}

function SearchIcon({ color, focused }: TabIconProps) {
  return <Icon name="search" size={26} color={color} weight={focused ? 'bold' : 'regular'} />;
}

function MessagesIcon({ color, focused }: TabIconProps) {
  return <MessagesTabIcon color={color} focused={focused} />;
}

function LibraryIcon({ color, focused }: TabIconProps) {
  return <Icon name="library" size={26} color={color} weight={focused ? 'fill' : 'regular'} />;
}

function ProfileIcon({ color, focused }: TabIconProps) {
  return <TabAvatar color={color} focused={focused} />;
}

// Android only. The library's own tab button draws a borderless ripple: a circle that spills past
// the tab and gets cut off wherever a parent clips it. A fade on press instead, as elsewhere in the
// app. `onPress` is the navigator's own, passed straight through, so it still owns the press.
function AndroidTabButton(props: BottomTabBarButtonProps) {
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      testID={props.testID}
      role={props.role}
      aria-label={props['aria-label']}
      aria-selected={props['aria-selected']}
      style={({ pressed }) => [props.style, pressed && styles.tabPressed]}
    >
      {props.children}
    </Pressable>
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

// Render callbacks the navigator invokes, hoisted so they aren't rebuilt per render.
const renderTabBar = (props: BottomTabBarProps) => <AnimatedTabBar {...props} />;
const renderTabBarBackground = () => <TabBarBackground />;
const renderTabScreen: React.ComponentProps<typeof Tab.Navigator>['screenLayout'] =
  Platform.OS === 'ios'
    ? ({ route, navigation, children }) =>
        route.name === 'Home' ? children : <TabSwipeBack navigation={navigation}>{children}</TabSwipeBack>
    : undefined;

export default function AppNavigator() {
  const insets = useSafeAreaInsets();
  const { showChrome } = useChromeVisibility();

  return (
    <UnreadBadgeProvider>
      <Tab.Navigator
        initialRouteName="Home"
        tabBar={renderTabBar}
        screenLayout={renderTabScreen}
        // Light tick on every tab press. A listener rather than a custom
        // tabBarButton so the navigator keeps owning the press — it still decides
        // navigate vs re-select-and-scroll-to-top; this only observes.
        //
        // Every tab arrives with the bar showing. Only Home and Profile hide it (on
        // scroll), so a tab like Library that inherited a hidden bar had no way to bring
        // it back — and, being a tab root, no back gesture either.
        screenListeners={{ tabPress: () => haptics.select(), focus: () => showChrome() }}
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarActiveTintColor: COLORS.white,
          tabBarInactiveTintColor: COLORS.white,
          tabBarLabelStyle: styles.tabLabel,
          tabBarStyle: [
            styles.tabBar,
            Platform.OS === 'android' && {
              height: 64 + insets.bottom + 16,
              paddingBottom: 8 + insets.bottom + 16,
            },
          ],
          tabBarItemStyle: styles.tabItem,
          tabBarButton: Platform.OS === 'android' ? AndroidTabButton : undefined,
          tabBarBackground: renderTabBarBackground,
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
          name="Inbox"
          component={InboxScreen}
          options={{ tabBarIcon: MessagesIcon, tabBarLabel: 'Messages' }}
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
    </UnreadBadgeProvider>
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
    // The outline is TabBarBackground's, which can curve. The library's own border and elevation would
    // draw a straight edge and square corners behind it.
    borderTopWidth: 0,
    elevation: 0,
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    // Android height/paddingBottom are overridden in screenOptions with insets.bottom
  },
  tabItem: {
    paddingVertical: 4,
  },
  tabPressed: { opacity: 0.6 },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 2,
  },
});

