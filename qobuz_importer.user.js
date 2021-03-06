// ==UserScript==
// @name           Import Qobuz releases to MusicBrainz
// @description    Add a button on Qobuz's album pages to open MusicBrainz release editor with pre-filled data for the selected release
// @version        2018.11.15.1
// @namespace      https://github.com/murdos/musicbrainz-userscripts
// @downloadURL    https://raw.github.com/murdos/musicbrainz-userscripts/master/qobuz_importer.user.js
// @updateURL      https://raw.github.com/murdos/musicbrainz-userscripts/master/qobuz_importer.user.js
// @include        /^https?://www\.qobuz\.com/[^/]+/album/[^/]+/[^/]+$/
// @require        https://ajax.googleapis.com/ajax/libs/jquery/2.1.4/jquery.min.js
// @require        lib/mbimport.js
// @require        lib/logger.js
// @require        lib/mblinks.js
// @require        lib/mbimportstyle.js
// @icon           https://raw.githubusercontent.com/murdos/musicbrainz-userscripts/master/assets/images/Musicbrainz_import_logo.png
// ==/UserScript==

// prevent JQuery conflicts, see http://wiki.greasespot.net/@grant
this.$ = this.jQuery = jQuery.noConflict(true);

if (!unsafeWindow) unsafeWindow = window;

var DEBUG = false;
//DEBUG = true;
if (DEBUG) {
    LOGGER.setLevel('debug');
}

// list of qobuz artist id which should be mapped to Various Artists
var various_artists_ids = [26887, 145383, 353325, 183869, 997899];

function parseRelease(data) {
    let release = {};

    release.script = 'Latn';
    release.url = `https://www.qobuz.com${data.relative_url}`; // no lang

    release.title = data.title;
    release.artist_credit = MBImport.makeArtistCredits([data.artist.name]); // FIXME: various artists
    if ($.inArray(data.artist.id, various_artists_ids) != -1) {
        release.artist_credit = [MBImport.specialArtist('various_artists')];
    }

    // Release information global to all Beatport releases
    release.packaging = 'None';
    release.barcode = data.upc;
    release.country = 'XW';
    if (i18n_global && i18n_global.zone) {
        release.country = i18n_global.zone;
    }
    release.status = 'official';
    release.urls = [];
    release.urls.push({
        url: release.url,
        link_type: MBImport.URL_TYPES.purchase_for_download
    });

    // release timestamps are using France time + daylight saving (GMT+1 or GMT+2),
    // add 3 hours to get the day of release (matching the one displayed)
    let releaseDate = new Date((parseInt(data.released_at, 10) + 3 * 3600) * 1000);
    release.year = releaseDate.getUTCFullYear();
    release.month = releaseDate.getUTCMonth() + 1;
    release.day = releaseDate.getUTCDate();

    release.labels = [];
    $.each(data.label.name.split(' - '), function(index, label) {
        release.labels.push({
            name: label,
            catno: '[none]' // no catno on qobuz ?
        });
    });
    release.isrcs = [];
    release.comment = 'Digital download';
    release.discs = [];
    let tracks = [],
        old_media_num = 1;
    $.each(data.tracks.items, function(index, trackobj) {
        release.isrcs.push(trackobj.isrc);
        if (trackobj.media_number != old_media_num) {
            release.discs.push({
                tracks: tracks,
                format: 'Digital Media'
            });
            old_media_num = trackobj.media_number;
            tracks = [];
        }
        let track = {};
        track.title = trackobj.title.replace('"', '"');
        track.duration = trackobj.duration * 1000;
        let performers = (typeof trackobj.performers !== 'undefined' &&
            trackobj.performers.split('\r - ').map(function(v) {
                let list = v.split(', ');
                let name = list.shift();
                return [name, list];
            })) || [trackobj.performer.name, ['Primary']];
        let artists = [];
        let featured_artists = [];
        $.each(performers, function(index, performer) {
            if ($.inArray('Featured Artist', performer[1]) != -1) {
                featured_artists.push(performer[0]);
            } else if (
                $.inArray('Main Performer', performer[1]) != -1 ||
                $.inArray('Primary', performer[1]) != -1 ||
                $.inArray('interprète', performer[1]) != -1 ||
                $.inArray('Performer', performer[1]) != -1 ||
                $.inArray('Main Artist', performer[1]) != -1
            ) {
                artists.push(performer[0]);
            }
        });
        track.artist_credit = MBImport.makeArtistCredits(artists);
        if (featured_artists.length) {
            if (track.artist_credit.length) {
                track.artist_credit[track.artist_credit.length - 1].joinphrase = ' feat. ';
            }
            $.merge(track.artist_credit, MBImport.makeArtistCredits(featured_artists));
        }
        tracks.push(track);
    });
    release.discs.push({
        tracks: tracks,
        format: 'Digital Media'
    });

    LOGGER.info('Parsed release: ', release);
    return release;
}

// Insert button into page under label information
function insertLink(release) {
    let edit_note = MBImport.makeEditNote(release.url, 'Qobuz');
    let parameters = MBImport.buildFormParameters(release, edit_note);

    let mbUI = $('<p class="musicbrainz_import">')
        .append(MBImport.buildFormHTML(parameters) + MBImport.buildSearchButton(release))
        .hide();
    mbUI.append($('<button id="isrcs" type="submit" title="Show list of ISRCs">Show ISRCs</button>'));
    let isrclist = $(`<p><textarea id="isrclist" style="display:none">${release.isrcs.join('\n')}</textarea></p>`);

    $('#info div.meta')
        .append(mbUI)
        .append(isrclist);
    $('form.musicbrainz_import').css({
        display: 'inline-block',
        margin: '1px'
    });
    $('form.musicbrainz_import img').css({
        display: 'inline-block',
        width: '16px',
        height: '16px'
    });
    mbUI.slideDown();
}

// Hook all XMLHttpRequest to use the data fetched by the official web-player.
(function() {
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            let wsUrl = 'https://www.qobuz.com/api.json/0.2/album/get?album_id=';
            let repUrl = arguments[0].originalTarget.responseURL;
            if (repUrl.startsWith(wsUrl)) {
                let data = JSON.parse(this.responseText);
                let release = parseRelease(data);
                insertLink(release);
            }
        });
        return send.apply(this, arguments);
    };
})();

$(document).ready(function() {
    MBImportStyle();

    // replace image zoom link by the maximum size image link
    let maximgurl = $('#product-cover-link')
        .attr('href')
        .replace('_600', '_max');
    let maximg = new Image();
    maximg.onerror = function(evt) {
        LOGGER.debug('No max image');
    };
    maximg.onload = function(evt) {
        $('#product-cover-link').attr('href', maximgurl);
        $('#product-cover-link').attr(
            'title',
            `${$('#product-cover-link').attr('title')} (Qobuz importer: ${maximg.width}x${maximg.height} image)`
        );
    };
    maximg.src = maximgurl;
});

$(document).on('click', '#isrcs', function() {
    $('#isrclist').toggle();
    if ($('#isrclist').is(':visible')) {
        $('#isrclist').select();
        $(this).text('Hide ISRCs');
    } else $(this).text('Show ISRCs');
    return false;
});
