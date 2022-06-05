# this file imports custom routes into the experiment server

from flask import Blueprint, render_template, request, jsonify, Response, abort, current_app
from jinja2 import TemplateNotFound
from functools import wraps
from sqlalchemy import or_

from psiturk.psiturk_config import PsiturkConfig
from psiturk.experiment_errors import ExperimentError, InvalidUsage
from psiturk.user_utils import PsiTurkAuthorization, nocache

# # Database setup
from psiturk.db import db_session, init_db
from psiturk.models import Participant
from json import dumps, loads

# For Captcha validation
import requests

# load the configuration options
config = PsiturkConfig()
config.load_config()
# if you want to add a password protect route use this
myauth = PsiTurkAuthorization(config)

# explore the Blueprint
custom_code = Blueprint('custom_code', __name__,
                        template_folder='templates', static_folder='static')


# SCIENCE_APP_URL = "http://127.0.0.1:5000/" # For local debugging
SCIENCE_APP_URL = "https://naive-curriculum-science.herokuapp.com/" # For actual deployment

###########################################################
#  serving warm, fresh, & sweet custom, user-provided routes
#  add them here
###########################################################

# ----------------------------------------------
# Computing Bonus
# ----------------------------------------------


@custom_code.route('/compute_bonus', methods=['GET'])
def compute_bonus():
    # check that user provided the correct keys
    # errors will not be that gracefull here if being
    # accessed by the Javascrip client
    if not 'uniqueId' in request.args:
        # i don't like returning HTML to JSON requests...  maybe should change this
        raise ExperimentError('improper_inputs')
    uniqueId = request.args['uniqueId']

    try:
        # lookup user in database
        user = Participant.query.\
            filter(Participant.uniqueid == uniqueId).\
            one()
        user_data = loads(user.datastring)  # load datastring from JSON

        current_app.logger.info("Reached /compute_bonus for user {}".format(uniqueId))

        score = 0
        max_score = 0

        for record in user_data['data']:  # for line in data file

            current_app.logger.info("Examining record from phase: {}".format(record.get("trialdata",{}).get("phase")))
            trial = record['trialdata']

            current_app.logger.error("User {}: checking record {}: {} for level {}, running score {}.".format(
                uniqueId, trial.get("name", "(no name)"), trial.get("event", "(no event)"), trial.get("level", "(no level)"), score))

            # We calculate bonus information from the score in each round:
            if trial.get("phase") == "gameplay" and trial.get("event") == "level_end":

                if trial.get("mode") != "normal":

                    current_app.logger.error("\tUser {}: NOT counting Level #{} (config: {}, mode: {}).".format(
                         uniqueId, trial.get("level"), trial.get("config_name"), trial.get("mode")))

                else:

                    current_app.logger.error("\tUser {}: COUNTING Level #{} (config {}, mode {}) --> score {}.".format(
                        uniqueId, trial.get("level"), trial.get("config_name"), trial.get("mode"), trial.get("score")))

                    score += trial.get("score", 0)
                    max_score += trial.get("level_max_score", 0)

                    if trial.get("score") > trial.get("level_max_score"):
                        msg = "WARNING: Player {} achieved {} (max {}) on level {} {}.".format(uniqueId, trial.get("score"), trial.get("level_max_score"), trial.get("config_name"), trial.get("level"))
                        current_app.logger.error(msg)

        current_app.logger.info("Bonus for {}: score {}, max {}".format(uniqueId, score, max_score))

        # See experiment design deck for details: http://bit.ly/naive_curriculum
        max_bonus = 1.75
        min_bonus = 0
        score_percent = 0

        if score > 0:
            score_percent = float(score) / max_score

        elif score < 0:
            message = "Negative score for {}: {}, setting to 0.".format(uniqueId, score)
            current_app.logger.error(message)
            score_percent = 0

        bonus = max_bonus * score_percent

        # Final sanity check
        if bonus > max_bonus:
            bonus = max_bonus
        elif bonus < min_bonus:
            bonus = min_bonus

        user.bonus = round(bonus, 2)

        current_app.logger.error("Bonus: {} for user {} based on {} of {}.".format(user.bonus, uniqueId, score, max_score))

        db_session.add(user)
        db_session.commit()
        resp = {"bonusComputed": "success"}

        return jsonify(**resp)

    except Exception as e:
        current_app.logger.error("ERROR on user {}:".format(e))
        abort(404)  # Return max bonus here instead?


# ----------------------------------------------
# Experiment Mechanics
# ----------------------------------------------

@custom_code.route("/set_condition", methods=['GET', 'POST'])
def set_condition():
    new_cond = request.args.get('new_cond', default=None, type=int)
    uniqueId = request.args['uniqueId']
    user = Participant.query. \
        filter(Participant.uniqueid == uniqueId). \
        one()
    old_cond = user.cond
    user.cond = new_cond
    db_session.commit()

    current_app.logger.error("Updated condition for {} from {} to {}:".format(uniqueId, old_cond, new_cond))

    return jsonify(**{'old_cond': old_cond, 'new_cond': new_cond})


@custom_code.route('/validate_captcha', methods=['POST', 'GET'])
def validate_captcha():

    response = request.args['captcha_string']
    secret = "6LchkdEUAAAAAIUFIOGT1yDCdKlKEDJyHJYAtuSh" # secrets, secrets, are no fun unless committed in plaintext

    # https://developers.google.com/recaptcha/docs/verify
    verified = requests.post('https://www.google.com/recaptcha/api/siteverify',
                             data={'secret': secret, "response": response})

    is_human = verified.json()["success"]

    return jsonify(**{"success": is_human})


# ----------------------------------------------
# Relay to Science Server (TM)
# ----------------------------------------------

@custom_code.route('/belief-update', methods=['POST'])
def belief_update():

    current_app.logger.error("PSITURK: Reached /belief-update")

    # Useful documentation on the different parts of a Flask request...
    # https://stackoverflow.com/questions/10434599/get-the-data-received-in-a-flask-request
    utterance = request.values.get('utterance')
    trajectory = request.values.get('trajectory')
    learner = request.values.get('learner')

    current_app.logger.error("\tUtterance: {}".format(utterance))
    current_app.logger.error("\tTrajectory: {}".format(trajectory))
    current_app.logger.error("\tLearner: {}".format(learner))

    response = requests.post(SCIENCE_APP_URL + 'belief-update',
                         json={'utterance': utterance, "trajectory": trajectory, "learner": learner})

    return jsonify(**response.json())

@custom_code.route('/new-agent', methods=['POST'])
def new_agent():

    print("PSITURK: Reached /new-agent")
    current_app.logger.error("PSITURK: Reached /new-agent")

    learner_config = request.values.get('learner_config')

    current_app.logger.error("\tConfig: {}".format(learner_config))

    response = requests.post(SCIENCE_APP_URL + 'new-agent',
                         json={'learner_config': learner_config})

    return jsonify(**response.json())

@custom_code.route('/execute-trajectory', methods=['POST'])
def execute_trajectory():

    current_app.logger.error("PSITURK: Reached /execute-trajectory")

    level_config = request.values.get('level_config')
    value_mask_config = request.values.get('value_mask_config')
    learner = request.values.get('learner')

    current_app.logger.error("\tLevel Config: {}".format(level_config))
    current_app.logger.error("\tValue Config: {}".format(value_mask_config))
    current_app.logger.error("\tLearner: {}".format(learner))

    response = requests.post(SCIENCE_APP_URL + 'execute-trajectory',
                         json={'learner': learner, "level_config": level_config, "value_mask_config": value_mask_config})

    return jsonify(**response.json())






