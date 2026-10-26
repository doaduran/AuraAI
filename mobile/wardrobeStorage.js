import AsyncStorage from '@react-native-async-storage/async-storage';

export default {
  getItem: () => AsyncStorage.getItem('aura_wardrobe'),
  setItem: value => AsyncStorage.setItem('aura_wardrobe', value),
};
