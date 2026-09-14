import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BackstagePassOnboarding from '../screens/auth/BackstagePassOnboarding';
import SignInScreen from '../screens/auth/SignInScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Onboarding"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0A0A0F' },
        gestureEnabled: false,
        animation: 'slide_from_right',
      }}
    >
      {/* The old single-screen hero lives on at screens/auth/OnboardingScreen
          as a fallback — swap it back here if the pass flow needs pulling. */}
      <Stack.Screen name="Onboarding" component={BackstagePassOnboarding} />
      <Stack.Screen name="SignIn" component={SignInScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
