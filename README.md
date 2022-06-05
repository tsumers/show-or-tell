## Show or Tell? Code and Data

This repo contains:
1. Experiment code (Javascript / PsiTurk)
2. Raw data from experiments
3. Post-processing and visualization code (Python)
4. Regression models (R)

Check out the different sections below for more info on each.

## Experiment Code
Experiments 1 and 2 use the PsiTurk framework and are primarily written in Javascript. 

### Playing the Experiment
Want to get a feel for the experiment? Try it yourself! 

The easiest way is to play the [live hosted instance of Experiment 2.](https://peaceful-spire-46995.herokuapp.com/) 

This URL uses free Heroku dynos so it will take 10-15 seconds to load the first time. 
Open it **twice**-- in two separate browser windows-- and advance through the instructions / practice rounds. 
You will be paired with yourself and be able to play through the entire experiment.

### Running Experiments Locally
If you would like to run the experiments locally, first install the Anaconda package manager.

Then, from the root directory, follow these steps:
1. Create Conda environment: `conda env create -f environment.yml`
2. Launch Conda environment: `conda activate show_or_tell`
3. Start local PsiTurk server: `psiturk server on`
4. Launch one debug trial: `psiturk debug`
5. Launch a second debug trial (to pair with the first): `psiturk debug`

Steps 4 and 5 will open two separate browser tabs with the experiment. 
Click through each, and after making it through the instructions and practice rounds, you'll arrive in a "waiting room."
Here, your two sessions will pair with each other.

### Switching Between Experiments
To switch between Experiments 1 and 2, you need to comment / uncomment two blocks of code:
1. In the root directory, `config.txt`, lines 42-46
2. In `static/js/task.js`, lines 26-46 

Then re-start the local server.

## Raw Data Analysis
Data analysis code consists of several Jupyter notebooks for processing raw data from the experiment and producing plots. 

You can run the R regression models independently of the Jupyter notebooks. This section is intended to go deeper-- if you want to, e.g. inspect the raw data (e.g., chat logs) or re-produce the plots in the paper.

To get a feel for the raw data without installing anything, you can check out the analysis notebooks directly in the repository:

1. [Experiment 1 analysis](/ipython/exp1_analysis.ipynb)
1. [Experiment 2 analysis](/ipython/exp2_analysis.ipynb)

If you want to explore the data yourself, first install the Anaconda package manager. Then, from the root directory:
1. Navigate to the analysis code: `cd ipython`
2. Unzip the raw experiment datafiles, `data.zip`
3. Install dedicated analysis Conda environment: `conda env create -f jupyter-env.yml`
4. Launch Conda environment: `conda activate jupyter`
5. Launch the Jupyter notebook server: `jupyter notebook`

You can now use either `exp1_analysis.ipynb` or `exp2_analysis.ipynb` to inspect the experiment data. 
The notebooks are organized to facilitate exploratory data analysis.

The notebook  `data_preprocessing.ipynb` notebook is provided as a record of pre-processing / anonymization done on the original, raw data.

## Regression Models 

Regression models in the paper and appendix can be found in the R markdown notebook in `ipython/boolean_complexity.Rmd` ([link](/ipython/boolean_complexity.Rmd)).

The R notebook loads pre-processed `.csv` files which are included directly in the repository, so it can be run independently of other analyses (e.g. without the Python code). You will need to install the requisite R packages.
