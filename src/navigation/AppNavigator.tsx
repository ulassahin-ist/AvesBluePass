// src/navigation/AppNavigator.tsx

import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import MainScreen from '../screens/MainScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CreateLoginScreen from '../screens/CreateLoginScreen';
import SetupScreen from '../screens/SetupScreen';

export type RootStackParamList = {
  Main: undefined;
  Settings: undefined;
  CreateLogin: undefined;
  Setup: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Main"
        screenOptions={{headerShown: false, animation: 'slide_from_right'}}>
        <Stack.Screen name="Main" component={MainScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="CreateLogin" component={CreateLoginScreen} />
        <Stack.Screen name="Setup" component={SetupScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
