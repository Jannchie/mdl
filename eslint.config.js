import jannchie from '@jannchie/eslint-config'

export default jannchie({
  ignores: [
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
  ],
})
