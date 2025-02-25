// ==UserScript==
// @name         threenow
// @description  Improve site usability. Watch videos in external player.
// @version      2.2.1
// @match        *://*.threenow.co.nz/*
// @icon         https://www.threenow.co.nz/assets/images/favicons/favicon.ico
// @run-at       document-end
// @grant        unsafeWindow
// @homepage     https://github.com/warren-bank/crx-threenow/tree/webmonkey-userscript/es5
// @supportURL   https://github.com/warren-bank/crx-threenow/issues
// @downloadURL  https://github.com/warren-bank/crx-threenow/raw/webmonkey-userscript/es5/webmonkey-userscript/threenow.user.js
// @updateURL    https://github.com/warren-bank/crx-threenow/raw/webmonkey-userscript/es5/webmonkey-userscript/threenow.user.js
// @namespace    warren-bank
// @author       Warren Bank
// @copyright    Warren Bank
// ==/UserScript==

// ----------------------------------------------------------------------------- user options

var user_options = {
  "common": {
    "debug_verbosity":              0,  // 0 = silent. 1 = console log. 2 = window alert. 3 = window alert + conditional breakpoint.
    "init_delay_ms":                0,
    "sort_newest_first":            true
  },
  "webmonkey": {
    "post_intent_redirect_to_url":  null  // "about:blank"
  },
  "greasemonkey": {
    "redirect_to_webcast_reloaded": true,
    "force_http":                   true,
    "force_https":                  false
  }
}

// ----------------------------------------------------------------------------- constants

var constants = {
  "button_attributes": {
    "reference_id":                 "x-reference-id",
    "video_url":                    "x-video-url",
    "video_type":                   "x-video-type",
    "caption_url":                  "x-caption-url",
    "referer_url":                  "x-referer-url",
    "drm_scheme":                   "x-drm-scheme",
    "drm_server":                   "x-drm-server"
  },
  "img_urls": {
    "base_webcast_reloaded_icons":  "https://github.com/warren-bank/crx-webcast-reloaded/raw/gh-pages/chrome_extension/2-release/popup/img/"
  }
}

var strings = {
  "button_download_video":          "Get Video URL",
  "button_start_video":             "Start Video",
  "episode_labels": {
    "title":                        "title:",
    "summary":                      "summary:",
    "duration":                     "duration:",
    "expires":                      "expires:",
    "video": {
      "format":                     "format:",
      "drm":                        "drm:"
    }
  },
  "livetv_epg_toggle_button": {
    "show":                         "Show",
    "hide":                         "Hide"
  },
  "livetv_channel_labels": {
    "epg": {
      "series_title":               "Series Title:",
      "episode_title":              "Episode Title:",
      "episode_summary":            "Summary:",
      "season_number":              "Season #:",
      "episode_number":             "Episode #:",
      "duration_date_range":        "Time:",
      "duration":                   "Duration:"
    }
  }
}

// ----------------------------------------------------------------------------- state

var state = {
  policy_key: null,
  account_id: null,

  series:   {}, // {title, summary}
  episodes: [], // [{reference_id, title, summary, duration, expires}]
  current_episode_index: -1,

  livetv_channels: [], // [{name, video_data, epg: [{series_title, episode_title, episode_summary, season_number, episode_number, duration_date_range, duration}]}]
  current_livetv_channel_index: -1
}

// ----------------------------------------------------------------------------- CSP

// add support for CSP 'Trusted Type' assignment
var add_default_trusted_type_policy = function() {
  if (typeof unsafeWindow.trustedTypes !== 'undefined') {
    try {
      var passthrough_policy = function(string) {return string}

      unsafeWindow.trustedTypes.createPolicy('default', {
          createHTML:      passthrough_policy,
          createScript:    passthrough_policy,
          createScriptURL: passthrough_policy
      })
    }
    catch(e) {}
  }
}

// ----------------------------------------------------------------------------- debug logger

var debug = function(msg, breakpoint) {
  if (!user_options.common.debug_verbosity) return

  if (msg) {
    if (typeof msg !== 'string')
      msg = JSON.stringify(msg, null, 2)

    switch(user_options.common.debug_verbosity) {
      case 1:
        console.log(msg)
        break
      case 2:
      case 3:
        unsafeWindow.alert(msg)
        break
    }
  }

  if (breakpoint && (user_options.common.debug_verbosity > 2))
    debugger;
}

// ----------------------------------------------------------------------------- helpers (xhr)

var serialize_xhr_body_object = function(data) {
  if (typeof data === 'string')
    return data

  if (!(data instanceof Object))
    return null

  var body = []
  var keys = Object.keys(data)
  var key, val
  for (var i=0; i < keys.length; i++) {
    key = keys[i]
    val = data[key]
    val = unsafeWindow.encodeURIComponent(val)

    body.push(key + '=' + val)
  }
  body = body.join('&')
  return body
}

var download_text = function(url, headers, data, callback) {
  if (data) {
    if (!headers)
      headers = {}
    if (!headers['content-type'])
      headers['content-type'] = 'application/x-www-form-urlencoded'

    switch(headers['content-type'].toLowerCase()) {
      case 'application/json':
        data = JSON.stringify(data)
        break

      case 'application/x-www-form-urlencoded':
      default:
        data = serialize_xhr_body_object(data)
        break
    }
  }

  var xhr    = new unsafeWindow.XMLHttpRequest()
  var method = data ? 'POST' : 'GET'

  xhr.open(method, url, true, null, null)

  if (headers && (typeof headers === 'object')) {
    var keys = Object.keys(headers)
    var key, val
    for (var i=0; i < keys.length; i++) {
      key = keys[i]
      val = headers[key]
      xhr.setRequestHeader(key, val)
    }
  }

  xhr.onload = function(e) {
    if (xhr.readyState === 4) {
      if ((xhr.status >= 200) && (xhr.status < 300)) {
        callback(null, xhr.responseText)
        return
      }
    }
    callback(new Error())
  }

  xhr.onerror = function(e) {
    callback(new Error())
  }

  if (data)
    xhr.send(data)
  else
    xhr.send()
}

var download_json = function(url, headers, data, callback) {
  if (!headers)
    headers = {}
  if (!headers.accept)
    headers.accept = 'application/json'

  download_text(url, headers, data, function(error, text){
    try {
      if (error)
        callback(error)
      else
        callback(null, JSON.parse(text))
    }
    catch(e) {}
  })
}

// ----------------------------------------------------------------------------- helpers

var make_element = function(elementName, html, text) {
  var el = unsafeWindow.document.createElement(elementName)

  if (html)
    el.innerHTML = html

  if (text)
    el.textContent = text

  return el
}

var make_span = function(text) {return make_element('span', null, text)}
var make_h4   = function(text) {return make_element('h4',   null, text)}

var add_style_element = function(css) {
  if (!css) return

  var head = unsafeWindow.document.getElementsByTagName('head')[0]
  if (!head) return

  if ('function' === (typeof css))
    css = css()
  if (Array.isArray(css))
    css = css.join("\n")

  head.appendChild(
    make_element('style', null, css)
  )
}

var empty_element = function(el, html, text) {
  while (el.childNodes.length)
    el.removeChild(el.childNodes[0])

  if (html)
    el.innerHTML = html

  if (text)
    el.textContent = text

  return el
}

var append_tr = function(tr, td, colspan) {
  if (Array.isArray(td))
    tr.push('<tr><td>' + td.join('</td><td>') + '</td></tr>')
  else if ((typeof colspan === 'number') && (colspan > 1))
    tr.push('<tr><td colspan="' + colspan + '">' + td + '</td></tr>')
  else
    tr.push('<tr><td>' + td + '</td></tr>')
}

var cancel_event = function(event) {
  event.stopPropagation();event.stopImmediatePropagation();event.preventDefault();event.returnValue=false;
}

// https://stackoverflow.com/a/66696162
var convertSecondsToReadableString = function(seconds) {
  seconds = seconds || 0
  seconds = Number(seconds)
  seconds = Math.abs(seconds)

  var d = Math.floor(seconds / (3600 * 24))
  var h = Math.floor(seconds % (3600 * 24) / 3600)
  var m = Math.floor(seconds % 3600 / 60)
  var s = Math.floor(seconds % 60)
  var parts = []

  if (d > 0) {
    parts.push(d + ' day' + (d > 1 ? 's' : ''))
  }
  if (h > 0) {
    parts.push(h + ' hour' + (h > 1 ? 's' : ''))
  }
  if (m > 0) {
    parts.push(m + ' minute' + (m > 1 ? 's' : ''))
  }
  if (s > 0) {
    parts.push(s + ' second' + (s > 1 ? 's' : ''))
  }
  return parts.join(', ')
}

var convertDateRangeToReadableString = function(start_date, end_date) {
  start_date = new Date(start_date)
  end_date   = new Date(end_date)

  var parts = {
    start_date: start_date.toLocaleDateString(),
    start_time: start_date.toLocaleTimeString(),

    end_date:   end_date.toLocaleDateString(),
    end_time:   end_date.toLocaleTimeString()
  }

  var range = parts.start_date + ' ' + parts.start_time + ' - ' + ((parts.end_date !== parts.start_date) ? (parts.end_date + ' ') : '') + parts.end_time
  return range
}

// ----------------------------------------------------------------------------- URL links to tools on Webcast Reloaded website

var get_webcast_reloaded_url = function(video_data, force_http, force_https) {
  force_http  = (typeof force_http  === 'boolean') ? force_http  : user_options.greasemonkey.force_http
  force_https = (typeof force_https === 'boolean') ? force_https : user_options.greasemonkey.force_https

  var encoded_video_url, encoded_caption_url, encoded_referer_url, encoded_drm_url, webcast_reloaded_base, webcast_reloaded_url

  encoded_video_url      = encodeURIComponent(encodeURIComponent(btoa(video_data.video_url)))
  encoded_caption_url    = video_data.caption_url ? encodeURIComponent(encodeURIComponent(btoa(video_data.caption_url))) : null
  video_data.referer_url = video_data.referer_url ? video_data.referer_url : unsafeWindow.location.href
  encoded_referer_url    = encodeURIComponent(encodeURIComponent(btoa(video_data.referer_url)))
  encoded_drm_url        = (video_data.drm.scheme && video_data.drm.server) ? encodeURIComponent(encodeURIComponent(btoa(video_data.drm.scheme + '|' + video_data.drm.server))) : null

  webcast_reloaded_base = {
    "https": "https://warren-bank.github.io/crx-webcast-reloaded/external_website/index.html",
    "http":  "http://webcast-reloaded.frii.site/index.html"
  }

  webcast_reloaded_base = (force_http)
                            ? webcast_reloaded_base.http
                            : (force_https)
                               ? webcast_reloaded_base.https
                               : (video_data.video_url.toLowerCase().indexOf('http:') === 0)
                                  ? webcast_reloaded_base.http
                                  : webcast_reloaded_base.https

  webcast_reloaded_url  = webcast_reloaded_base    + '#/watch/'    + encoded_video_url
                            + (encoded_caption_url ? ('/subtitle/' + encoded_caption_url) : '')
                            + (encoded_referer_url ? ('/referer/'  + encoded_referer_url) : '')
                            + (encoded_drm_url     ? ('/drm/'      + encoded_drm_url) : '')

  return webcast_reloaded_url
}

var get_webcast_reloaded_url_chromecast_sender = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ null, /* force_https= */ null).replace('/index.html', '/chromecast_sender.html')
}

var get_webcast_reloaded_url_airplay_sender = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/airplay_sender.es5.html')
}

var get_webcast_reloaded_url_proxy = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/proxy.html')
}

var get_webcast_reloaded_urls = function(video_data) {
  return {
    "index":             get_webcast_reloaded_url(                  video_data),
    "chromecast_sender": get_webcast_reloaded_url_chromecast_sender(video_data),
    "airplay_sender":    get_webcast_reloaded_url_airplay_sender(   video_data),
    "proxy":             get_webcast_reloaded_url_proxy(            video_data)
  }
}

// ----------------------------------------------------------------------------- URL handlers

var redirect_to_url = function(url) {
  if (!url) return

  if (typeof GM_loadUrl === 'function') {
    if (typeof GM_resolveUrl === 'function')
      url = GM_resolveUrl(url, unsafeWindow.location.href) || url

    GM_loadUrl(url, 'Referer', unsafeWindow.location.href)
  }
  else {
    try {
      unsafeWindow.top.location = url
    }
    catch(e) {
      unsafeWindow.window.location = url
    }
  }
}

var process_webmonkey_post_intent_redirect_to_url = function() {
  var url = null

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'string')
    url = user_options.webmonkey.post_intent_redirect_to_url

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'function')
    url = user_options.webmonkey.post_intent_redirect_to_url()

  if (typeof url === 'string')
    redirect_to_url(url)
}

// -----------------------------------------------------------------------------

var process_video_data = function(data) {
  if (!data.video_url) return

  if (!data.referer_url)
    data.referer_url = unsafeWindow.location.href

  if (typeof GM_startIntent === 'function') {
    // running in Android-WebMonkey: open Intent chooser

    if (!data.video_type)
      data.video_type = determine_video_type(data.video_url)

    var args = [
      /* action = */ 'android.intent.action.VIEW',
      /* data   = */ data.video_url,
      /* type   = */ data.video_type
    ]

    // extras:
    if (data.caption_url) {
      args.push('textUrl')
      args.push(data.caption_url)
    }
    if (data.referer_url) {
      args.push('referUrl')
      args.push(data.referer_url)
    }
    if (data.drm.scheme) {
      args.push('drmScheme')
      args.push(data.drm.scheme)
    }
    if (data.drm.server) {
      args.push('drmUrl')
      args.push(data.drm.server)
    }
    if (data.drm.headers && (typeof data.drm.headers === 'object')) {
      var drm_header_keys, drm_header_key, drm_header_val

      drm_header_keys = Object.keys(data.drm.headers)
      for (var i=0; i < drm_header_keys.length; i++) {
        drm_header_key = drm_header_keys[i]
        drm_header_val = data.drm.headers[drm_header_key]

        args.push('drmHeader')
        args.push(drm_header_key + ': ' + drm_header_val)
      }
    }

    GM_startIntent.apply(this, args)
    process_webmonkey_post_intent_redirect_to_url()
    return true
  }
  else if (user_options.greasemonkey.redirect_to_webcast_reloaded) {
    // running in standard web browser: redirect URL to top-level tool on Webcast Reloaded website

    redirect_to_url(
      get_webcast_reloaded_url(data)
    )
    return true
  }
  else {
    return false
  }
}

var process_hls_data = function(data) {
  data.video_type = 'application/x-mpegurl'
  process_video_data(data)
}

var process_dash_data = function(data) {
  data.video_type = 'application/dash+xml'
  process_video_data(data)
}

// -----------------------------------------------------------------------------

var process_video_url = function(video_url, video_type, caption_url, referer_url, drm_scheme, drm_server) {
  var data = {
    video_url:   video_url   || null,
    video_type:  video_type  || null,
    caption_url: caption_url || null,
    referer_url: referer_url || null,
    drm: {
      scheme:    drm_scheme,
      server:    drm_server,
      headers:   null
    }
  }

  process_video_data(data)
}

var process_hls_url = function(hls_url, caption_url, referer_url, drm_scheme, drm_server) {
  process_video_url(/* video_url= */ hls_url, /* video_type= */ 'application/x-mpegurl', caption_url, referer_url, drm_scheme, drm_server)
}

var process_dash_url = function(dash_url, caption_url, referer_url, drm_scheme, drm_server) {
  process_video_url(/* video_url= */ dash_url, /* video_type= */ 'application/dash+xml', caption_url, referer_url, drm_scheme, drm_server)
}

// ----------------------------------------------------------------------------- API: download series media items

var download_episodes_list = function(showId, videoId, callback) {
  var meta, meta_data

  try {
    meta = unsafeWindow.document.querySelector('meta[name="mw-3now/config/environment"][content]')
    if (!meta) throw 0

    meta_data = JSON.parse(
      decodeURIComponent(
        meta.getAttribute('content')
      )
    )

    if (!meta_data || (typeof meta_data !== 'object') || !meta_data.brightcoveAccountId || !meta_data.brightcovePolicyKey) throw 0
  }
  catch(e) {
    return
  }

  state.policy_key = meta_data.brightcovePolicyKey
  state.account_id = meta_data.brightcoveAccountId

  download_json(
    /* url= */ 'https://now-api.fullscreen.nz/v5/shows/' + showId,
    /* headers= */ null,
    /* data= */ null,
    function(error, series_data) {
      if (error) return

      debug('series_data: ' + typeof series_data)
      debug('seasons: ' + typeof series_data.seasons + ' (' + (Array.isArray(series_data.seasons) ? 'array' : 'not array') + ')')
      if (!series_data || (typeof series_data !== 'object') || !Array.isArray(series_data.seasons) || !series_data.seasons.length) return

      state.series = {
        title:   series_data.name,
        summary: series_data.synopsis
      }

      state.episodes = normalize_episodes_list(
        find_episodes_list(series_data.seasons)
      )

      debug('episodes: ' + typeof state.episodes + ' (' + ((state.episodes === null) ? 'null' : state.episodes.length) + ')')
      if (!state.episodes || !state.episodes.length) return

      if (user_options.common.sort_newest_first)
        state.episodes.reverse()

      if (videoId) {
        for (var i=0; i < state.episodes.length; i++) {
          if (state.episodes[i].videoId === videoId) {
            state.current_episode_index = i
            break
          }
        }
      }

      callback()
    }
  )
}

var find_episodes_list = function(seasons) {
  var all_episodes = []
  var season, i, j

  for (i=0; i < seasons.length; i++) {
    season = seasons[i]

    if (!season || (typeof season !== 'object') || !Array.isArray(season.episodes) || !season.episodes.length)
      continue

    for (j=0; j < season.episodes.length; j++) {
      all_episodes.push(
        season.episodes[j]
      )
    }
  }

  return all_episodes
}

var normalize_episodes_list = function(all_episodes) {
  if (!Array.isArray(all_episodes) || !all_episodes.length) return null

  return all_episodes.map(function(episode) {
    if (!episode || (typeof episode !== 'object') || !episode.externalMediaId || !episode.name) return null

    var duration, expires

    duration = episode.duration
      ? convertSecondsToReadableString(
          episode.duration
        )
      : null

    expires = episode.expiryDate
      ? convertSecondsToReadableString(
          ((new Date(episode.expiryDate)).getTime() - Date.now()) / 1000
        )
      : null

    return {
      videoId:      episode.videoId,
      reference_id: episode.externalMediaId,
      title:        episode.name,
      summary:      episode.synopsis,
      duration:     duration,
      expires:      expires
    }
  })
  .filter(function(episode) {
    return !!episode
  })
}

// ----------------------------------------------------------------------------- API: download video sources

var download_video_sources = function(reference_id, callback) {
  download_json(
    /* url= */ 'https://edge.api.brightcove.com/playback/v1/accounts/' + state.account_id + '/videos/' + reference_id,
    /* headers= */ {
      "BCOV-POLICY": state.policy_key
    },
    /* data= */ null,
    function(error, $brightcove_data) {
      if (error) return

      if (!$brightcove_data || (typeof $brightcove_data !== 'object') || !Array.isArray($brightcove_data.sources) || !$brightcove_data.sources.length) return

      $brightcove_data.sources = $brightcove_data.sources.filter(function(vidsrc) {
        return !!(vidsrc && (typeof vidsrc === 'object') && vidsrc.src && vidsrc.type)
      })
      if (!$brightcove_data.sources.length) return

      var caption_url

      if (Array.isArray($brightcove_data.text_tracks) && $brightcove_data.text_tracks.length) {
        $brightcove_data.text_tracks = $brightcove_data.text_tracks.filter(function(txtrack) {
          return !!(txtrack && (typeof txtrack === 'object') && txtrack.src && (txtrack.kind === 'captions') && (txtrack.mime_type === 'text/webvtt'))
        })

        if ($brightcove_data.text_tracks.length) {
          caption_url = $brightcove_data.text_tracks[0].src
        }
      }

      var video_sources = []
      var drm_schemes = ['widevine', 'clearkey', 'playready', 'fairplay']
      var src, video_data, has_drm, drm_keys, drm_key, drm_data, drm_scheme

      for (var i=0; i < $brightcove_data.sources.length; i++) {
        src = $brightcove_data.sources[i]

        video_data = {
          video_url:   src.src,
          video_type:  src.type,
          caption_url: caption_url,
          referer_url: null,
          drm: {
            scheme:    null,
            server:    null,
            headers:   null
          }
        }

        has_drm = false

        if (src.key_systems && (typeof src.key_systems === 'object')) {
          drm_keys = Object.keys(src.key_systems)

          if (drm_keys.length)
            has_drm = true

          for (var j=0; j < drm_keys.length; j++) {
            drm_key  = drm_keys[j]
            drm_data = src.key_systems[drm_key]

            if (drm_data && (typeof drm_data === 'object') && drm_data.license_url) {
              drm_scheme = resolve_drm_scheme(drm_schemes, drm_key)

              if (drm_scheme) {
                video_sources.push(
                  Object.assign({}, video_data, {drm: {
                    scheme:  drm_scheme,
                    server:  drm_data.license_url,
                    headers: null
                  }})
                )
              }
            }
          }
        }

        if (!has_drm) {
          video_sources.push(video_data)
        }
      }

      callback(video_sources)
    }
  )
}

var resolve_drm_scheme = function(drm_schemes, drm_key) {
  var drm_scheme

  for (var i=0; i < drm_schemes.length; i++) {
    drm_scheme = drm_schemes[i]

    if (drm_key.indexOf(drm_scheme) >= 0) {
      return drm_scheme
    }
  }

  return null
}

// ----------------------------------------------------------------------------- API: download live tv guide

var download_livetv_guide = function(channelId, callback) {
  download_json(
    /* url= */ 'https://now-api.fullscreen.nz/v5/live-epg',
    /* headers= */ null,
    /* data= */ null,
    function(error, livetv_data) {
      if (error) return

      debug('livetv_data: ' + typeof livetv_data)
      debug('channels: ' + typeof livetv_data.channels + ' (' + (Array.isArray(livetv_data.channels) ? 'array' : 'not array') + ')')
      if (!livetv_data || (typeof livetv_data !== 'object') || !Array.isArray(livetv_data.channels) || !livetv_data.channels.length) return

      state.series = {
        title:   'Live TV Channels',
        summary: null
      }

      state.livetv_channels = normalize_livetv_channels_list(
        livetv_data.channels
      )

      debug('live tv channels: ' + typeof state.livetv_channels + ' (' + ((state.livetv_channels === null) ? 'null' : state.livetv_channels.length) + ')')
      if (!state.livetv_channels || !state.livetv_channels.length) return

      if (channelId) {
        for (var i=0; i < state.livetv_channels.length; i++) {
          if (state.livetv_channels[i].channelId === channelId) {
            state.current_livetv_channel_index = i
            break
          }
        }
      }

      download_livetv_channel_3(callback)
    }
  )
}

var normalize_livetv_channels_list = function(all_channels) {
  if (!Array.isArray(all_channels) || !all_channels.length) return null

  return all_channels.map(function(channel) {
    if (!channel || (typeof channel !== 'object') || !channel.channelId || !channel.displayName || !channel.videoRenditions || (typeof channel.videoRenditions !== 'object') || !channel.videoRenditions.hlsUrl) return null

    var epg = (Array.isArray(channel.broadcasts) && channel.broadcasts.length)
      ? channel.broadcasts.map(function(broadcast) {
          var duration_date_range, duration

          duration_date_range = (broadcast.startDate && broadcast.endDate)
            ? convertDateRangeToReadableString(broadcast.startDate, broadcast.endDate)
            : null

          duration = broadcast.duration
            ? convertSecondsToReadableString(
                broadcast.duration
              )
            : null

          return {
            series_title:        broadcast.title,
            episode_title:       broadcast.episodeName,
            episode_summary:     broadcast.episodeSynopsis,
            season_number:       broadcast.seriesNumber,
            episode_number:      broadcast.episodeNumber,
            duration_date_range: duration_date_range,
            duration:            duration
          }
        })
      : null

    var video_data = {
      videoRenditions: channel.videoRenditions,
      video_url:       channel.videoRenditions.hlsUrl,
      video_type:      'application/x-mpegurl',
      caption_url: null,
      referer_url: null,
      drm: {
        scheme:    null,
        server:    null,
        headers:   null
      }
    }

    return {
      channelId:  channel.channelId,
      name:       channel.displayName,
      video_data: video_data,
      epg:        epg
    }
  })
  .filter(function(episode) {
    return !!episode
  })
}

// ----------------------------------------------------------------------------- API: download live tv channel 3

var download_livetv_channel_3 = function(callback) {
  var videoRenditions = null
  var channel_3_index = -1

  for (var i=0; i < state.livetv_channels.length; i++) {
    if (state.livetv_channels[i].channelId === 'three') {
      videoRenditions = state.livetv_channels[i].video_data.videoRenditions
      channel_3_index = i
    }
  }

  if (!videoRenditions || (typeof videoRenditions !== 'object') || !videoRenditions.lsai || (typeof videoRenditions.lsai !== 'object') || !videoRenditions.lsai.csab) {
    callback()
  }
  else {
    download_json(
      /* url= */ videoRenditions.lsai.csab,
      /* headers= */ {'content-type': 'application/json'},
      /* data= */ {"adsParams": {"channelId": "three", "watchFromStart": "", "PPID": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "cust_params": "show%3D%7BcurrentShowTitle%7D%26episode%3D%7BcurrentEpisodeTitle%7D%26channel%3Dthree%26scor%3D%7BplaybackSessionId%7D%26msg%3D%5Bmsg%5D%26description_url%3Dhttps%3A%2F%2Fwww.threenow.co.nz%2Flive-tv-guide%2Fthree%26genre%3D%7BcurrentShowGenre%7D%26classification%3D%7BcurrentShowClassification%7D%26season%3D%7BcurrentShowSeason%7D%26url%3Dhttps%3A%2F%2Fwww.threenow.co.nz%2Flive-tv-guide%2Fthree", "sz": "620x288", "iu_parts": "/4100/three-live/desktop-ss/{currentShowTitle}", "description_url": "https%253A%252F%252Fwww.threenow.co.nz%252Flive-tv-guide%252Fthree", "url": "https%253A%252F%252Fwww.threenow.co.nz%252Flive-tv-guide%252Fthree", "platform": "desktop"}},
      function(error, channel_3_urls) {
        if (!error && channel_3_urls && channel_3_urls.manifestUrl) {
          if (channel_3_urls.manifestUrl[0] === '/') {
            var regex = new RegExp('^(https?://[^/]+).*$', 'i')
            var match = regex.exec(videoRenditions.lsai.csab)

            if (match) {
              channel_3_urls.manifestUrl = match[1] + channel_3_urls.manifestUrl
            }
          }

          state.livetv_channels[channel_3_index].video_data.video_url = channel_3_urls.manifestUrl
        }
        callback()
      }
    )
  }
}

// ----------------------------------------------------------------------------- DOM: static skeleton

var reinitialize_dom = function() {
  add_default_trusted_type_policy()

  unsafeWindow.document.close()
  unsafeWindow.document.open()
  unsafeWindow.document.write('')
  unsafeWindow.document.close()

  empty_element(unsafeWindow.document.getElementsByTagName('head')[0])
  empty_element(unsafeWindow.document.body)

  add_style_element(function(){
    return [
      // --------------------------------------------------- reset

      'body {',
      '  margin: 0;',
      '  padding: 0;',
      '  font-family: serif;',
      '  font-size: 16px;',
      '  background-color: #fff !important;',
      '  overflow: auto !important;',
      '}',

      'body > div.ember-view,',
      'body > iframe {',
      '  display: none !important;',
      '}',

      // --------------------------------------------------- series title

      'body > div > h2 {',
      '  display: block;',
      '  margin: 0;',
      '  padding: 0.5em;',
      '  font-size: 22px;',
      '  text-align: center;',
      '  background-color: #ccc;',
      '}',

      // --------------------------------------------------- series description

      'body > div > div {',
      '  padding: 0.5em;',
      '  font-size: 18px;',
      '}',

      // --------------------------------------------------- list of videos: episodes in series, or individual movie or episode

      'body > div > ul {',
      '  list-style: none;',
      '  margin: 0;',
      '  padding: 0;',
      '  padding-left: 1em;',
      '  padding-bottom: 1em;',
      '}',

      'body > div > ul > li {',
      '  list-style: none;',
      '  margin-top: 0.5em;',
      '  border-top: 1px solid #999;',
      '  padding-top: 0.5em;',
      '}',

      'body > div > ul > li > table td:first-child {',
      '  font-style: italic;',
      '  padding-right: 1em;',
      '}',

      'body > div > ul > li > blockquote {',
      '  display: block;',
      '  background-color: #eee;',
      '  padding: 0.5em 1em;',
      '  margin: 0;',
      '}',

      'body > div > ul > li > blockquote + div {',
      '  margin: 0.75em 0;',
      '}',

      // --------------------------------------------------- drm

      'body > div > ul > li > blockquote + div > table {',
      '  width: 100%;',
      '  border-collapse: collapse;',
      '}',

      'body > div > ul > li > blockquote + div > table tr > td:first-child + td {',
      '  width: 100%;',
      '}',

      'body > div > ul > li > blockquote + div > table tr > td {',
      '  border-top: 1px solid #999;',
      '  padding: 0.5em 0;',
      '}',

      'body > div > ul > li > blockquote + div > table tr:first-child > td {',
      '  border-top-style: none;',
      '}',

      'body > div > ul > li > blockquote + div > table button {',
      '  white-space: nowrap;',
      '}',

      'body > div > ul > li > blockquote + div > table tr > td:last-child > div.icons-container {',
      '}',

      // --------------------------------------------------- links to tools on Webcast Reloaded website

      'body > div > ul > li div.icons-container {',
      '  display: block;',
      '  position: relative;',
      '  z-index: 1;',
      '  float: right;',
      '  margin: 0.5em;',
      '  width: 60px;',
      '  height: 60px;',
      '  max-height: 60px;',
      '  vertical-align: top;',
      '  background-color: #d7ecf5;',
      '  border: 1px solid #000;',
      '  border-radius: 14px;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.chromecast > img,',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.airplay > img,',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.proxy > img,',
      'body > div > ul > li div.icons-container > a.video-link,',
      'body > div > ul > li div.icons-container > a.video-link > img {',
      '  display: block;',
      '  width: 25px;',
      '  height: 25px;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  position: absolute;',
      '  z-index: 1;',
      '  text-decoration: none;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.airplay {',
      '  top: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  bottom: 0;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.proxy {',
      '  left: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  right: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.airplay + a.video-link {',
      '  right: 17px; /* (60 - 25)/2 to center when there is no proxy icon */',
      '}',

      // --------------------------------------------------- live tv channel

      'body > div > ul > li > blockquote + div > table.livetv-channel tr {',
      '  vertical-align: top;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel tr > td {',
      '  padding: 0;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel tr > td:first-child {',
      '  white-space: nowrap;',
      '  padding-right: 1em;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel tr > td > h3 {',
      '  padding: 0;',
      '  margin: 0;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel table {',
      '  width: 100%;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel table table tr > td {',
      '  border-style: none;',
      '  padding: 0.25em 0;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel div.livetv-epg-toggle-container {',
      '  transition: height  0.5s linear;',
      '  overflow-y: hidden !important;',
      '  height: auto !important;',
      '}',

      'body > div > ul > li > blockquote + div > table.livetv-channel div.livetv-epg-toggle-container.toggle-hide {',
      '  height: 0px !important;',
      '}',

      ''
    ]
  })

  var div, ul, li
  var i

  div = make_element('div')
  ul  = make_element('ul')
  div.appendChild(ul)

  if (state.series.title) {
    div.insertBefore(
      make_element('h2', null, state.series.title),
      ul
    )
  }

  if (state.series.summary) {
    div.insertBefore(
      make_element('div', null, state.series.summary),
      ul
    )
  }

  for (i=0; i < state.episodes.length; i++) {
    li = make_episode_listitem_element(
      state.episodes[i]
    )

    if (li) {
      ul.appendChild(li)

      if (i === state.current_episode_index) {
        li.querySelector(':scope button[' + constants.button_attributes.reference_id + ']').click()
      }
    }
  }

  for (i=0; i < state.livetv_channels.length; i++) {
    li = make_livetv_channel_listitem_element(
      state.livetv_channels[i]
    )

    if (li) {
      ul.appendChild(li)

      if (i === state.current_livetv_channel_index) {
        li.querySelector(':scope button[' + constants.button_attributes.video_url + ']').click()
      }
    }
  }

  unsafeWindow.document.body.appendChild(div)
}

// ----------------------------------------------------------------------------- DOM: <li> for episode in show series

var make_episode_listitem_element = function(episode) {
  // const {reference_id, title, summary, duration, expires} = episode

  var tr, html, li, div_dynamic

  tr = []
  if (episode.title)
    append_tr(tr, [strings.episode_labels.title, episode.title])
  if (episode.duration)
    append_tr(tr, [strings.episode_labels.duration, episode.duration])
  if (episode.expires)
    append_tr(tr, [strings.episode_labels.expires, episode.expires])
  if (episode.summary)
    append_tr(tr, strings.episode_labels.summary, 2)

  html = [
    '<table>' + tr.join("\n") + '</table>',
    '<blockquote>' + episode.summary + '</blockquote>',
    '<div></div>'
  ]

  li = make_element('li', html.join("\n"))

  div_dynamic = li.querySelector(':scope > div')
  div_dynamic.appendChild(
    make_download_video_button(episode.reference_id)
  )

  return li
}

var make_download_video_button = function(reference_id) {
  var button = make_element('button')

  button.setAttribute(constants.button_attributes.reference_id, reference_id)
  button.textContent = strings.button_download_video
  button.addEventListener("click", onclick_download_video_button)

  return button
}

var onclick_download_video_button = function(event) {
  cancel_event(event)

  var button, div_dynamic, reference_id

  button = event.target
  if (!button) return

  div_dynamic = button.parentElement
  if (!div_dynamic) return

  reference_id = button.getAttribute(constants.button_attributes.reference_id)
  if (!reference_id) return

  add_video_sources_to_episode_listitem_element(div_dynamic, reference_id)
}

var add_video_sources_to_episode_listitem_element = function(div_dynamic, reference_id) {
  download_video_sources(reference_id, function(video_sources) {
    // video_sources is array of video_data: {video_url, video_type, caption_url, referer_url, drm: {scheme, server, headers}}

    var tr, video_data, video_summary, td_button, td_icons, div_icons, a_icons, a_icon
    var i

    tr = []
    for (i=0; i < video_sources.length; i++) {
      video_data = video_sources[i]

      video_summary  = '<ul>'
      video_summary += '  <li>' + strings.episode_labels.video.format + ' ' + video_data.video_type + '</li>'
      video_summary += '  <li>' + strings.episode_labels.video.drm    + ' ' + (video_data.drm.scheme || 'none') + '</li>'
      video_summary += '</ul>'

      append_tr(tr, ['', video_summary, '']) // col 1: button. col 3: icons.
    }
    empty_element(div_dynamic, '<table>' + tr.join("\n") + '</table>')

    tr = div_dynamic.querySelectorAll(':scope > table tr')

    for (i=0; i < tr.length; i++) {
      video_data = video_sources[i]

      td_button = tr[i].querySelector(':scope > td:first-child')
      td_icons  = tr[i].querySelector(':scope > td:last-child')

      add_start_video_button(/* block_element= */ td_button, video_data)

      if (video_data.drm.scheme) {
        div_icons = make_webcast_reloaded_div(video_data)

        a_icons = {
          real:    {},  // order: chromecast, airplay, [proxy], video-link
          ordered: []
        }

        a_icons.real.airplay    = div_icons.querySelector('a.airplay')
        a_icons.real.direct_hls = div_icons.querySelector('a.video-link')

        a_icon = a_icons.real.direct_hls.cloneNode(/* deep= */ true)
        a_icon.className = 'chromecast'
        a_icons.ordered.push(a_icon)

        a_icon = a_icons.real.direct_hls.cloneNode(/* deep= */ true)
        a_icon.className = 'airplay'
        a_icon.setAttribute('href',  video_data.drm.server)
        a_icon.setAttribute('title', 'direct link to ' + video_data.drm.scheme + ' drm server')
        a_icons.ordered.push(a_icon)

        a_icon = a_icons.real.airplay.cloneNode(/* deep= */ true)
        a_icon.className = 'video-link'
        a_icons.ordered.push(a_icon)

        empty_element(div_icons)

        for (var j=0; j < a_icons.ordered.length; j++) {
          a_icon = a_icons.ordered[j]

          div_icons.appendChild(a_icon)
        }
        a_icons = null

        td_icons.appendChild(div_icons)
      }
      else {
        insert_webcast_reloaded_div(/* block_element= */ td_icons, video_data)
      }
    }
  })
}

var add_start_video_button = function(block_element, video_data) {
  var new_button = make_start_video_button(video_data)

  block_element.appendChild(new_button)
}

var make_start_video_button = function(video_data) {
  var button = make_element('button')

  button.setAttribute(constants.button_attributes.video_url,   video_data.video_url   || '')
  button.setAttribute(constants.button_attributes.video_type,  video_data.video_type  || '')
  button.setAttribute(constants.button_attributes.caption_url, video_data.caption_url || '')
  button.setAttribute(constants.button_attributes.referer_url, video_data.referer_url || '')
  button.setAttribute(constants.button_attributes.drm_scheme,  video_data.drm.scheme  || '')
  button.setAttribute(constants.button_attributes.drm_server,  video_data.drm.server  || '')
  button.textContent = strings.button_start_video
  button.addEventListener("click", onclick_start_video_button)

  return button
}

var onclick_start_video_button = function(event) {
  cancel_event(event)

  var button      = event.target
  var video_url   = button.getAttribute(constants.button_attributes.video_url)
  var video_type  = button.getAttribute(constants.button_attributes.video_type)
  var caption_url = button.getAttribute(constants.button_attributes.caption_url)
  var referer_url = button.getAttribute(constants.button_attributes.referer_url)
  var drm_scheme  = button.getAttribute(constants.button_attributes.drm_scheme)
  var drm_server  = button.getAttribute(constants.button_attributes.drm_server)

  if (video_url)
    process_video_url(video_url, video_type, caption_url, referer_url, drm_scheme, drm_server)
}

// -----------------------------------------------------------------------------

var insert_webcast_reloaded_div = function(block_element, video_data) {
  var webcast_reloaded_div = make_webcast_reloaded_div(video_data)

  block_element.appendChild(webcast_reloaded_div)
}

var make_webcast_reloaded_div = function(video_data) {
  var webcast_reloaded_urls = get_webcast_reloaded_urls(video_data)

  var div = make_element('div')

  var html = [
    '<a target="_blank" class="chromecast" href="' + webcast_reloaded_urls.chromecast_sender   + '" title="Chromecast Sender"><img src="'       + constants.img_urls.base_webcast_reloaded_icons + 'chromecast.png"></a>',
    '<a target="_blank" class="airplay" href="'    + webcast_reloaded_urls.airplay_sender      + '" title="ExoAirPlayer Sender"><img src="'     + constants.img_urls.base_webcast_reloaded_icons + 'airplay.png"></a>',
    '<a target="_blank" class="proxy" href="'      + webcast_reloaded_urls.proxy               + '" title="HLS-Proxy Configuration"><img src="' + constants.img_urls.base_webcast_reloaded_icons + 'proxy.png"></a>',
    '<a target="_blank" class="video-link" href="' + video_data.video_url                      + '" title="direct link to video"><img src="'    + constants.img_urls.base_webcast_reloaded_icons + 'video_link.png"></a>'
  ]

  div.setAttribute('class', 'icons-container')
  div.innerHTML = html.join("\n")

  return div
}

// ----------------------------------------------------------------------------- DOM: <li> for live tv channel

var make_livetv_channel_listitem_element = function(channel) {
  // const {name, video_data, epg} = channel

  var tr, epg_html, html, li, buttons_container, livetv_epg_toggle_button

  tr = []
  if (Array.isArray(channel.epg) && channel.epg.length) {
    for (var i=0; i < channel.epg.length; i++) {
      append_tr(
        tr,
        add_epg_to_livetv_channel_listitem_element(channel.epg[i])
      )
    }
  }

  epg_html = []
  if (tr.length) {
    epg_html = [
      '<h3>EPG:</h3>',
      '<button class="livetv-epg-toggle-button">' + strings.livetv_epg_toggle_button.show + '</button>',
      '<div class="livetv-epg-toggle-container toggle-hide">',
        '<table class="livetv-epg">',
          '<tr><td></td></tr>',
          tr.join("\n"),
        '</table>',
      '</div>'
    ]
  }

  html = [
    '<blockquote>' + channel.name + '</blockquote>',
    '<div>',
      '<table class="livetv-channel">',
        '<tr>',
          '<td class="livetv-channel-buttons"></td>',
          '<td>',
            epg_html.join("\n"),
          '</td>',
        '</tr>',
      '</table>',
    '</div>'
  ]

  li = make_element('li', html.join("\n"))

  epg_html = null
  html = null

  buttons_container = li.querySelector(':scope td.livetv-channel-buttons')

  add_start_video_button(     buttons_container, channel.video_data)
  insert_webcast_reloaded_div(buttons_container, channel.video_data)

  livetv_epg_toggle_button = li.querySelector(':scope button.livetv-epg-toggle-button')
  if (livetv_epg_toggle_button) {
    livetv_epg_toggle_button.addEventListener("click", onclick_livetv_epg_toggle_button)
  }

  return li
}

var add_epg_to_livetv_channel_listitem_element = function(epg) {
  // const {series_title, episode_title, episode_summary, season_number, episode_number, duration_date_range, duration} = epg

  var tr = []
  if (epg.duration_date_range)
    append_tr(tr, [strings.livetv_channel_labels.epg.duration_date_range, epg.duration_date_range])
  if (epg.duration)
    append_tr(tr, [strings.livetv_channel_labels.epg.duration, epg.duration])
  if (epg.series_title)
    append_tr(tr, [strings.livetv_channel_labels.epg.series_title, epg.series_title])
  if (epg.episode_title)
    append_tr(tr, [strings.livetv_channel_labels.epg.episode_title, epg.episode_title])
  if (epg.episode_summary)
    append_tr(tr, [strings.livetv_channel_labels.epg.episode_summary, epg.episode_summary])
  if (epg.season_number)
    append_tr(tr, [strings.livetv_channel_labels.epg.season_number, epg.season_number])
  if (epg.episode_number)
    append_tr(tr, [strings.livetv_channel_labels.epg.episode_number, epg.episode_number])

  return '<table>' + tr.join("\n") + '</table>'
}

var onclick_livetv_epg_toggle_button = function(event) {
  cancel_event(event)

  var className = 'toggle-hide'
  var button, div_dynamic

  button = event.target
  if (!button) return

  div_dynamic = button.nextElementSibling
  if (!div_dynamic || !div_dynamic.classList.contains('livetv-epg-toggle-container')) return

  if (div_dynamic.classList.contains(className)) {
    // toggle: hide => show
    div_dynamic.classList.remove(className)
    button.textContent = strings.livetv_epg_toggle_button.hide
  }
  else {
    // toggle: show => hide
    div_dynamic.classList.add(className)
    button.textContent = strings.livetv_epg_toggle_button.show
  }
}

// ----------------------------------------------------------------------------- bootstrap: shows

var page_init_shows = function() {
  var regexs = {
    series_url:  new RegExp('^/shows/[^/]+/([^/]+)/?(?:[#\?].*)?$'),
    episode_url: new RegExp('^/shows/[^/]+/[^/]+/([^/]+)/([^/]+)/?(?:[#\?].*)?$')
  }

  var path = unsafeWindow.location.pathname
  var match, showId, videoId

  if (!showId) {
    match = regexs.series_url.exec(path)
    if (match) {
      showId = match[1]
    }
  }
  if (!showId) {
    match = regexs.episode_url.exec(path)
    if (match) {
      showId  = match[1]
      videoId = match[2]
    }
  }
  debug('showId: '  + showId, true)
  debug('videoId: ' + videoId)
  if (showId) {
    download_episodes_list(showId, videoId, reinitialize_dom)
    return true
  }
  return false
}

// ----------------------------------------------------------------------------- bootstrap: live tv

var page_init_livetv = function() {
  var regexs = {
    channel_url: new RegExp('^/live-tv-guide/?([^/#\?]+)?(?:[/#\?].*)?$')
  }

  var path = unsafeWindow.location.pathname
  var match, channelId

  match = regexs.channel_url.exec(path)
  if (match) {
    channelId = match[1]
    download_livetv_guide(channelId, reinitialize_dom)
    return true
  }
  return false
}

// ----------------------------------------------------------------------------- bootstrap: all other pages

var page_init_default = function() {
  // force web 1.0 navigation on anchor click
  unsafeWindow.document.addEventListener("click", function(event) {
    var element = event.target
    var anchor, url

    if (element instanceof HTMLAnchorElement) {
      anchor = element
    }
    else {
      // inspect parent elements
      while (element.parentElement) {
        element = element.parentElement
        if (element instanceof HTMLAnchorElement) {
          anchor = element
          break
        }
      }
    }

    if (anchor instanceof HTMLAnchorElement) {
      if (anchor.hasAttribute('href')) {
        url = anchor.getAttribute('href')
      }
      else if (anchor.hasAttribute('data-name')) {
        // special handler for top navmenu
        switch(anchor.getAttribute('data-name')) {
          case 'home':
            url = '/'
            break
          case 'livestreams':
            url = '/live-tv-guide'
            break
          case 'categories':
            url = '/categories'
            break
        }
      }

      if (url) {
        redirect_to_url(url)
        cancel_event(event)
      }
    }
  }, true)

  return true
}

// ----------------------------------------------------------------------------- bootstrap

var page_init = function() {
  debug('initializing..', true)

  page_init_shows() || page_init_livetv() || page_init_default()
}

if (user_options.common.init_delay_ms)
  unsafeWindow.setTimeout(page_init, user_options.common.init_delay_ms)
else
  page_init()
