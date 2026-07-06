package com.devioarts.capacitor.rest;

import com.getcapacitor.Logger;

public class CapacitorREST {

    public String echo(String value) {
        Logger.info("Echo", value);
        return value;
    }
}
