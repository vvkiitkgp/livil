// Native views with nothing behind them under Jest, and the package ships untranspiled.
const { View } = require('react-native');

module.exports = { LiquidGlassView: View, BlurView: View };
