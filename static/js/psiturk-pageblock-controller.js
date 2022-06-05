/**
 * Created by markho on 1/7/18.
 */

// var $ = require('jquery');

/***********************************
    Page Block Controller
************************************/
function PageBlockController(parent, pages, callback, closeAlert, manual_saveData) {

    var psiturk = parent;
    var currentscreen = 0, timestamp;

    manual_saveData = typeof(manual_saveData) === 'undefined' ? false : manual_saveData;

    closeAlert = typeof(closeAlert) === 'undefined' ? true : closeAlert;
    if (closeAlert) {
        closeAlert = function(){
            return 'Please do not close or reload this window before ' +
                'completing the task. Doing so will invalidate your responses!';
        };
        $(window).bind('beforeunload', closeAlert);
    }

    if (typeof(callback) === 'undefined') {
        callback = function() {
            psiturk.computeBonus('compute_bonus', function(resp){
                console.log(resp);
                if (closeAlert) {
                    $(window).unbind('beforeunload', closeAlert);
                }

                // PROLIFIC vs MTURK.... this is not guaranteed to work for all experiments.
                if (new URLSearchParams(location.search).get('hitId') === 'prolific') {
                    $(window).off("beforeunload");
                    $('#prolific-complete').show()
                } else {
                    psiturk.completeHIT(); // when finished saving, compute bonus then quit
                }

            });
        };
    }

    var loadPage = function() {
        // show the page
        var continue_func = function (callback) {callback()};
        if (typeof(pages[currentscreen]) === "string") {
            psiturk.showPage(pages[currentscreen]);
        }
        else {
            psiturk.showPage(pages[currentscreen]['pagename']);
            if (pages[currentscreen].hasOwnProperty('pagefunc')) {
                pages[currentscreen]['pagefunc']();
            }
            if (pages[currentscreen].hasOwnProperty('continuefunc')) {
                continue_func = pages[currentscreen]['continuefunc'];
            }
        }

        // connect event handler to continue button
        $('.instructionsnav').on('click.psiturk.instructionsnav.next',
            '.continue', function() {
            continue_func(nextPageButtonPress);
            // nextPageButtonPress();
        });

        // Record the time that an exp page is first presented
        timestamp = new Date().getTime();
    };

    var question_validation = function () {
        //correct answer required
        if (_.contains(this.classList, "correct-answer-required")) {
            //check if required radio buttons have no answer
            if ($(this).find("input:radio").length > 0 &&
                    $(this).find("input:radio:checked").length === 0) {
                $(this).addClass("invalid-response");
                $(this).append("<div class='invalid-response-text'>Response required</div>");
                all_valid = false;
                window.scrollTo($(this).position()['left'], $(this).position()['top'])
            }

            //check if checked radio button is not correct
            if ($(this).find("input:radio").length > 0 &&
                    $(this).find("input:radio:checked").length > 0) {
                var checked_radio = $(this).find("input:radio:checked")[0];
                if (!_.contains(checked_radio.classList, "correct-answer")) {
                    $(this).addClass("invalid-response");
                    $(this).append(
                        "<div class='invalid-response-text'> Check your response</div>");
                    window.scrollTo($(this).position()['left'], $(this).position()['top'])
                }
            }
        }

        //any answer required
        if (_.contains(this.classList, "answer-required")) {
            //radio questions
            if ($(this).find("input:radio").length > 0 &&
                    $(this).find("input:radio:checked").length === 0) {
                $(this).addClass("invalid-response");
                $(this).append(
                    "<div class='invalid-response-text'>Response required</div>"
                );
                window.scrollTo($(this).position()['left'], $(this).position()['top'])
            }
            //slider questions
            if ($(this).find("input[type=range]").length > 0) {
                var slider = $(this).find("input[type=range]")[0];
                if (!_.contains(slider.classList, "selected-slider")) {
                    $(this).addClass("invalid-response");
                    $(this).append(
                        "<div class='invalid-response-text'>Response required</div>"
                    );
                    window.scrollTo($(this).position()['left'], $(this).position()['top'])
                }
            }
            
            //text questions
            if ($(this).find("textarea").length > 0) {
                var textarea = $(this).find("textarea")[0];
                var text = textarea.value;
                if (text.length == 0) {
                    $(this).addClass("invalid-response");
                    $(this).append(
                        "<div class='invalid-response-text'>Response required</div>"
                    );
                    window.scrollTo($(this).position()['left'], $(this).position()['top'])
                }
                else if (_.contains(this.classList, "number-required") && isNaN(text)) {
                    $(this).addClass("invalid-response");
                    $(this).append(
                        "<div class='invalid-response-text'>Number required</div>"
                    );
                    window.scrollTo($(this).position()['left'], $(this).position()['top'])
                }
            }

            //required interaction
            if ($(this).find(".no-interaction").length > 0) {
                var question = $(this).find(".no-interaction")[0];
                $(this).addClass("invalid-response");
                $(this).append(
                    "<div class='invalid-response-text'>Required</div>"
                );
                window.scrollTo($(this).position()['left'], $(this).position()['top'])
            }
        }
    };

    var nextPageButtonPress = function() {
        // validation
        $(".invalid-response-text").each(function () {this.remove()});
        $(".invalid-response").removeClass("invalid-response");

        $(".question").each(question_validation);

        if ($(".invalid-response").length) {
            return
        }

        // Record the response time
        var rt = (new Date().getTime()) - timestamp;
        var viewedscreen = currentscreen;
        currentscreen = currentscreen + 1;

        $('textarea').each( function(i, val) {
            console.log(this.id + " : " + this.value);
			psiturk.recordUnstructuredData(this.id, this.value);
		});
		$('select').each( function(i, val) {
		    console.log(this.id + " : " + this.value);
			psiturk.recordUnstructuredData(this.id, this.value);
		});
		$('input:radio:checked').each(function(i, val) {
		    console.log(this.name + " : " + this.value);
            psiturk.recordUnstructuredData(this.name, this.value);
        });
		$("input[type=range]").each(function () {
		    console.log(this.id + " : " + this.value);
		    psiturk.recordUnstructuredData(this.id, this.value);
		});
		$(".videocontainer").each(function () {
		    console.log(this.id + " : " + JSON.stringify(this.playdata));
		    psiturk.recordUnstructuredData(this.id, this.playdata);
        });

        if (currentscreen >= pages.length) {
            psiturk.recordTrialData({
                "template":pages[viewedscreen],
                "indexOf":viewedscreen,
                "action":"FinishInstructions",
                "viewTime":rt
            });
            if (!manual_saveData) {
                psiturk.saveData({
                    'success': function () {
                        finish();
                        window.scrollTo(0, 0);
                    }
                });
            }
            else {
                finish();
                window.scrollTo(0, 0);
            }


        } else {
            psiturk.recordTrialData({
                "template":pages[viewedscreen],
                "indexOf":viewedscreen,
                "action":"NextPage",
                "viewTime":rt
            });

            if (!manual_saveData) {
                psiturk.saveData({
                    'success': function () {
                        loadPage();
                        window.scrollTo(0, 0);
                    }
                });
            }
            else {
                loadPage();
                window.scrollTo(0, 0);
            }
        }
    };

    var finish = function() {
        // unbind all instruction related events
        $('.continue').unbind('click.psiturk.instructionsnav.next');
        callback();
    };

    /* public interface */
    this.loadPage = loadPage;
    this.finish = finish;

    return this;
}



function PageBlockSurveyHandler(config) {

    var containername = config.containername;

    //default config
    config = Object.assign({}, {
        includebreaks: true
    }, config);

    var defaults = {
        'numeric-text': {
            type: 'numeric-text',
            questiontext: 'Numeric Input Default',
            cols: 20,
            rows: 1,
            name: "numeric-input-default",
            required: true,
            leftalign: true,
            number: true
        },
        'textbox': {
            type: 'textbox',
            questiontext: "TEXTBOX",
            rows: 5,
            cols: 50,
            name: 'textbox-default',
            leftalign: true,
            required: true
        },
        'vertical-radio': {
            type: 'vertical-radio',
            name: 'vertical-radio-default',
            questiontext: 'Vertical Radio Default',
            hascorrect: false,
            required: true,
            leftalign: true,
            options: [
                {
                    value: '0',
                    optiontext: 'Option 0',
                    correct: false
                }
            ]
        },
        'horizontal-radio': {
            type: 'horizontal-radio',
            name: 'horizontal-radio-default',
            questiontext: 'Horizontal Radio Default',
            hascorrect: false,
            required: true,
            leftalign: false,
            options: [
                {
                    value: '0',
                    optiontext: 'Option 0',
                    correct: false
                }
            ]
        },
        'textdisplay': {
            type: 'textdisplay',
            name: 'textdisplay-default',
            questiontext: "<p>Some text</p>"
        },
        'videodisplay': {
            type: 'videodisplay',
            name: 'videodisplay-default',
            src: "",
            srctype: "video/mp4",
            required: true,
            questiontext: `
                <div class="videocontainer">
                    <div class="videocover">
                        Click to play
                    </div>
                </div>
            `
        },
        'taskdisplay': {
            type: 'taskdisplay',
            name: 'taskdisplay-default',

        }
    };

    var addClass = function(element, classname) {
        var arr = element.className.split(" ");
        if (arr.indexOf(classname) === -1) {
            element.className += " " + classname;
        }
    };

    var add_radioquestion = function (params, questiondiv) {
        for (var i = 0; i < params.options.length; i++) {
            var option = params.options[i];
            var optiondiv = document.createElement('DIV');
            if (params.type === 'vertical-radio') {
                addClass(optiondiv, "vertical-radio-option");
            }
            if (params.type === 'horizontal-radio') {
                addClass(optiondiv, "horizontal-radio-option");
            }

            //input
            var optioninput = document.createElement("INPUT");
            optioninput.setAttribute("type", "radio");
            optioninput.setAttribute("name", params.name);
            optioninput.setAttribute("id", params.name+"-"+i);
            optioninput.setAttribute("value", option.value);
            if (option.correct) {
                addClass(optioninput, "correct-answer")
            }
            optiondiv.appendChild(optioninput);

            //label
            var optionlabel = document.createElement("LABEL");
            optionlabel.setAttribute("for", params.name+"-"+i);
            optionlabel.innerHTML = option.optiontext;
            optiondiv.appendChild(optionlabel);

            questiondiv.appendChild(optiondiv)
        }
    };

    var add_textbox = function(params, questiondiv) {
        var input = document.createElement("TEXTAREA");
        input.setAttribute("rows", params.rows);
        input.setAttribute("id", params.name);
        input.setAttribute("cols", params.cols);
        questiondiv.appendChild(input);
    };

    var add_videodisplay_question = function(params, questiondiv) {
        //set up video player element
        var vcontainer = $(questiondiv).find(".videocontainer")[0];
        $(vcontainer).attr('id', params.name);
        var vid = document.createElement("VIDEO");
        $(vid).attr("preload", "auto");
        $(vid).html("Your browser does not support HTML5 video");
        var source = document.createElement("SOURCE");
        $(source).attr("src", params.src);
        $(source).attr("type", params.srctype);
        vid.appendChild(source);
        vcontainer.appendChild(vid);

        if (params.required) {
            addClass(vcontainer, "no-interaction");
        }

        vcontainer.playdata = {plays: 0};

        //set up playback function
        $(vcontainer).on('click', (function (vcontainer, vid, params) {
            return function () {
                vid.load();
                var vcover = $(vcontainer).find(".videocover")[0];
                vcover.style.visibility = "hidden";
                setTimeout(function () {vid.play()}, 1000);
                vid.onended = (function (vcover, vcontainer) {
                    return function () {
                        vcover.style.visibility = "visible";
                        vcover.innerHTML = "Click to replay";
                        $(vcontainer).removeClass("no-interaction");
                        vcontainer.playdata['plays'] += 1;
                    }
                })(vcover, vcontainer);
            }
        })(vcontainer, vid, params));
    };

    this.addone = function(params) {
        var parent = document.getElementById(containername);
        var questiondiv = document.createElement("DIV");

        //set defaults
        if (
            (params.type === 'vertical-radio') ||
            (params.type === 'horizontal-radio')
        ){
            for (var o = 0; o < params.options; o++) {
                params.options[o].value =
                    typeof(params.options[o].value) === 'undefined' ?
                        o : params.options[o].value;
                params.options[o].correct =
                    typeof(params.options[o].correct) === 'undefined' ?
                        false : params.options[o].correct;
            }
        }
        params = Object.assign({}, defaults[params.type], params);

        //question text div
        var qtext = document.createElement("DIV");
        qtext.innerHTML = params['questiontext'];
        questiondiv.appendChild(qtext);

        //input divs
        if (params.type === 'numeric-text') {
            add_textbox(params, questiondiv);
        }
        if (params.type === 'textbox') {
            add_textbox(params, questiondiv);
        }
        if (params.type === 'vertical-radio') {
            add_radioquestion(params, questiondiv);
        }
        if (params.type === 'horizontal-radio') {
            add_radioquestion(params, questiondiv);
        }
        if (params.type === 'videodisplay') {
            add_videodisplay_question(params, questiondiv);
        }

        //question container
        var qcontainer = document.createElement("DIV");
        addClass(qcontainer, "question");
        if (params.required) {
            addClass(qcontainer, "answer-required")
        }
        if (params.leftalign) {
            addClass(qcontainer, "left-align")
        }
        if (params.number) {
            addClass(qcontainer, "number-required")
        }
        qcontainer.appendChild(questiondiv);

        //add contained question
        parent.appendChild(qcontainer);
        if (config.includebreaks) {
            parent.appendChild(document.createElement("BR"));
            parent.appendChild(document.createElement("HR"));
        }
    };

    this.add = function(paramlist) {
        for (var q = 0; q < paramlist.length; q++) {
            this.addone(paramlist[q]);
        }
    };

    return this;

}