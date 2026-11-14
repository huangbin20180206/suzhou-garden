// node --import ./probe/_actor-sim/register.mjs …：装上 hooks.mjs（见其头注释）
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
