import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent, App.js hem Expo Go'da hem de production build'de
// (standalone) doğru şekilde root component olarak ayarlanmasını sağlar.
registerRootComponent(App);
