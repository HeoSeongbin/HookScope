import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',use:{baseURL:'http://localhost:8088',viewport:{width:1440,height:1000}},workers:1,reporter:'list'});
