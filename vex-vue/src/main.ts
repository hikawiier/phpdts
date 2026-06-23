import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/styles/input.css';
import './assets/styles/terminal.css';
import './assets/styles/battle.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
