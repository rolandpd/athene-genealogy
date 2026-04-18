import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.ts'],
			exclude: [
				'src/**/*.d.ts',
				'src/**/*.test.ts',
				'src/i18n/**',
				'src/modal/**',
				'src/settings.ts',
				'src/main.ts',
			],
		},
	},
});
