# Castle Rock Conditions Dashboard

<p>
	<img src="public/images/crsp-hands.png" alt="Castle Rock hand image 1" height="300" />
</p>
<p></p>https://mpj2104.github.io/castle-rock-conditions/</p>

This is a static React dashboard that checks Castle Rock climbing conditions from the [Ben Lomond BNDC1 station on the NOAA site](https://forecast.weather.gov/MapClick.php?lon=-122.10464186850001&lat=37.23500005365938#.ZGzoAuzMKDX). The site is built to show temperature, humidity, fuel moisture, wind speed, and precipitation history in an interactive plot. Everything was constructed entirely via vibe coding with the GPT-5.3-Codex model.

## Pipeline

1. At the 58th minute of each hour, a workflow ("Sync Synoptic Data") is triggered via an external cronjob to capture the latest conditions data and push it to `public/data/observations`. The workflow runs at this time, because updates for this station on the NOAA site usually happen at the 50th minute of each hour and can sometimes be a few minutes delayed.
2. Upon completion of this workflow, another workflow ("Deploy Site") is triggered that incorporates the new data into the [published dashboard hosted on GitHub Pages](https://mpj2104.github.io/castle-rock-conditions/).
3. Changes on the dashboard can be seen upon a manual refresh or an auto-refresh that occurs every 5 minutes.

## Key Markers

Several markers have been put in place to indicate specific conditions thresholds:
- In the Temperature (orange) and Relative Humidity (green) plot, two dashed lines appear at 60F and 35% humidity. Based on my personal experience, I've had the stickiest conditions when the temperature AND humidity hover around those values. Whenever the temperature is between 55F and 65F AND the humidity is between 30% and 40% for at least 2 consecutive time readings, there will be a golden-shaded region on the plot.
- In the Fuel Moisture (blue) plot, a dashed line appears at 10%. This is most relevant to view when there has been recent precipitation. Generally speaking, when the fuel moisture is above 10%, I've found that the fragile sandstone is still moist and SHOULD NOT be climbed on.
- In the "Latest Reading" card there is a dot indicator, which turns Red when there has been any precipitation in the past 72 hours AND the fuel moisture is at least 10% and turns Green when there has been no precipitation in the past 72 hours AND the fuel moisture is less than 10%. I use this as guidance on whether it's worth it to drive to Castle Rock to physically check on the conditions.

## Warning
DO NOT CLIMB ON WET SANDSTONE!!! SANDSTONE IS FRAGILE AND CAN/WILL BREAK IF YOU CLIMB ON IT TOO SOON AFTER RAIN!!!

Use this dashboard as part of your evaluation on whether it is OK to climb the sandstone at Castle Rock. The general rule of thumb is to wait at least 72 hours after the last rain, but this varies depending on the amount of precipitation that occurred, the amount of sun exposure in the following days, which rocks are in the shade, etc. It is still best to make your judgment when you are at the rock and observing the moisture levels on both the rock and the surrounding soil. The dashboard helps as a first proxy to determine whether it's worth the drive up.
