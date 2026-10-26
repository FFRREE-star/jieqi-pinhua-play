// 网页总线限幅器（exp5，用户说声音太大、有爆音）。
// Godot 网页版默认用浏览器的 Web Audio 直接放声音（Sample 模式），总线上的效果器不起作用，
// 所以在这里把所有接到扬声器的声音先送进一个压缩 / 限幅器，再出去：几声叠在一起也不会超过满刻度、不会削波爆音。
// 另外 Godot 改音量是直接写 gain.value（一下就跳过去），配乐淡入淡出每一帧跳一级，帧率低时就一下一下地“咔”；
// 这里让每个音量旋钮第一次设定照旧（声音一开始就是对的音量），之后的改动都在约 15ms 里滑过去。
(function () {
  if (window.AudioParam && window.BaseAudioContext) {
    var desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
    var createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () {
      var g = createGain.apply(this, arguments);
      var param = g.gain;
      var ctx = this;
      var first = true;
      Object.defineProperty(param, 'value', {
        configurable: true,
        get: function () { return desc.get.call(param); },
        set: function (v) {
          if (first || ctx.state !== 'running') {
            first = false;
            param.cancelScheduledValues(0);
            desc.set.call(param, v);
            return;
          }
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setTargetAtTime(v, now, 0.005); // 时间常数 5ms，约 15ms 到位
        }
      });
      return g;
    };
  }

  if (!window.AudioNode || !window.AudioDestinationNode) return;
  var connect = AudioNode.prototype.connect;
  var limiters = new WeakMap();
  function limiterFor(dest) {
    var ctx = dest.context;
    var lim = limiters.get(ctx);
    if (!lim) {
      lim = ctx.createDynamicsCompressor();
      var thr = -4, ratio = 20;
      lim.threshold.value = thr; // dBFS：比这响的部分按 20:1 压下去（当限幅器用）
      lim.knee.value = 2;
      lim.ratio.value = ratio;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      // 浏览器的压缩器会自动补增益（约 0.6 ×(-thr + thr/ratio) dB），这里扣回去，再多留 1 dB：
      // 平常的声音不变响，最响也就到 -3 dBFS 左右
      var makeup = 0.6 * (-thr + thr / ratio);
      var out = ctx.createGain();
      out.gain.value = Math.pow(10, (-makeup - 1) / 20);
      connect.call(lim, out);
      connect.call(out, dest);
      limiters.set(ctx, lim);
      window.__jieqiLimiter = lim;
    }
    return lim;
  }
  AudioNode.prototype.connect = function (dest) {
    if (dest instanceof AudioDestinationNode) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = limiterFor(dest);
      connect.apply(this, args);
      return dest;
    }
    return connect.apply(this, arguments);
  };
})();
