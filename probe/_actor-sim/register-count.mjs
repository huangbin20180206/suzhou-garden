// node --import ./probe/_actor-sim/register-count.mjs …：装上 hooks-count.mjs（计数版 vendor）
import { register } from 'node:module';
register('./hooks-count.mjs', import.meta.url);
